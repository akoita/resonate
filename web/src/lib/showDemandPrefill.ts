/** Scene Scout suggestions initialize an editable form, never grant authority. */
export type ShowDemandPrefill = {
  city: string;
  country: string;
  releaseId: string;
};

export function showDemandPrefill(
  params: Record<string, string | string[] | undefined>,
): ShowDemandPrefill | undefined {
  const { city, country, releaseId } = params;
  if (
    typeof city !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city) || city.length > 80 ||
    typeof country !== "string" || !/^[A-Z]{2}$/.test(country) ||
    typeof releaseId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(releaseId)
  ) return undefined;
  return {
    city: city.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    country,
    releaseId,
  };
}
