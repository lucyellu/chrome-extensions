import { getSetting, setSetting, updateAdEvent } from "./db.js";

export const DEFAULT_AI_SETTINGS = {
  providerName: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKey: "",
  maxBatchSize: 20
};

export async function getAiSettings() {
  const settings = await getSetting("aiSettings", DEFAULT_AI_SETTINGS);
  return {
    ...DEFAULT_AI_SETTINGS,
    ...settings
  };
}

export async function saveAiSettings(settings) {
  const normalized = {
    providerName: settings.providerName?.trim() || DEFAULT_AI_SETTINGS.providerName,
    baseUrl: normalizeBaseUrl(settings.baseUrl || DEFAULT_AI_SETTINGS.baseUrl),
    model: settings.model?.trim() || DEFAULT_AI_SETTINGS.model,
    apiKey: settings.apiKey?.trim() || "",
    maxBatchSize: Number(settings.maxBatchSize) || DEFAULT_AI_SETTINGS.maxBatchSize
  };

  await setSetting("aiSettings", normalized);
  return normalized;
}

export async function runSmartFilter(events, settings) {
  if (!settings.apiKey) {
    throw new Error("Add an API key before running the smart filter.");
  }

  const batch = events.slice(0, settings.maxBatchSize).map(toModelAd);

  if (batch.length === 0) {
    return [];
  }

  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const body = {
    model: settings.model,
    messages: [
      {
        role: "system",
        content: [
          "You are a personal ad triage assistant inside an ad-filter extension.",
          "The user wants calm browsing and a later review of ads that might actually be worth attention.",
          "Recommend 'yes' only when an ad seems concretely useful, relevant, verifiable, or worth a human look.",
          "Recommend 'no' for vague, low-information, suspicious, spammy, tracking-heavy, or generic ads.",
          "Do not claim an offer is real or safe unless the supplied data proves it.",
          "Return only JSON with this shape: {\"recommendations\":[{\"id\":\"ad id\",\"suggestion\":\"yes or no\",\"confidence\":0.0,\"reason\":\"short reason\",\"tags\":[\"short tag\"]}]}."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Suggest yes/no for these saved ad events. The user will make the final decision.",
          ads: batch
        })
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 2200,
    stream: false
  };

  if (baseUrl.includes("deepseek.com")) {
    body.thinking = { type: "disabled" };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message || `Smart filter failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  const recommendations = parseRecommendations(content);
  const byId = new Map(events.map((event) => [event.id, event]));
  const applied = [];
  const now = new Date().toISOString();

  for (const recommendation of recommendations) {
    const event = byId.get(recommendation.id);

    if (!event) {
      continue;
    }

    const suggestion = recommendation.suggestion === "yes" ? "yes" : "no";
    const meta = {
      providerName: settings.providerName,
      baseUrl: normalizeBaseUrl(settings.baseUrl),
      model: settings.model,
      suggestedDecision: suggestion,
      confidence: clampConfidence(recommendation.confidence),
      reason: String(recommendation.reason || "").slice(0, 240),
      tags: Array.isArray(recommendation.tags) ? recommendation.tags.map(String).slice(0, 5) : [],
      createdAt: now
    };

    const updated = await updateAdEvent(event.id, {
      recommendedBy: `${settings.providerName}:${settings.model}`,
      recommendationMeta: meta
    });

    if (updated) {
      applied.push(updated);
    }
  }

  return applied;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function toModelAd(event) {
  return {
    id: event.id,
    adDomain: event.adDomain || "",
    adUrl: event.adUrl || "",
    pageDomain: event.pageDomain || "",
    pageTitle: event.pageTitle || "",
    source: event.source || "",
    notes: event.notes || "",
    snapshotText: event.snapshot?.text || "",
    snapshotImageUrl: event.snapshot?.imageUrl || "",
    tags: event.tags || []
  };
}

function parseRecommendations(content) {
  if (!content) {
    return [];
  }

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.recommendations)) {
    return [];
  }

  return parsed.recommendations.filter((item) => item && typeof item.id === "string");
}

function clampConfidence(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(1, numeric));
}
