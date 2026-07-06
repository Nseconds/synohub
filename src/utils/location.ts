export function normalizeLocationName(value: unknown): string {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;]+$/, "")
    .trim();
  if (!cleaned) return "";

  const exact = cleaned.toLowerCase();
  const locationAliases: Record<string, string> = {
    auh: "Abu Dhabi",
    ad: "Abu Dhabi",
    "abu dhabi": "Abu Dhabi",
    dxb: "Dubai",
    dubai: "Dubai",
    shj: "Sharjah",
    sharjah: "Sharjah",
    ajman: "Ajman",
    fujairah: "Fujairah",
    rak: "Ras Al Khaimah",
    "ras al khaimah": "Ras Al Khaimah",
    uaq: "Umm Al Quwain",
    "umm al quwain": "Umm Al Quwain",
  };

  if (locationAliases[exact]) return locationAliases[exact];

  return cleaned.replace(/\b(auh|ad|abu dhabi|dxb|dubai|shj|sharjah|ajman|fujairah|rak|ras al khaimah|uaq|umm al quwain)\b/gi, (match) => {
    return locationAliases[match.toLowerCase()] || match;
  });
}
