import type { Card } from "./load.ts";

type Quote = string | string[];
type YamlPath = (string | number)[];

interface QuotedField {
  path: string;
  yamlPath: YamlPath;
  quote: Quote;
  text?: { path: string; value: string };
}

export function quotesOf(quote: Quote | undefined): string[] {
  if (!quote) return [];
  return Array.isArray(quote) ? quote : [quote];
}

/** 同一字段同时供规则定位问题和草稿修复定位 YAML 节点。 */
export function quoteFieldsOf(card: Card): QuotedField[] {
  const fields: QuotedField[] = [];
  function add(
    entry: { quote?: Quote; text?: string; what?: string } | null | undefined,
    path: string,
    yamlPath: YamlPath,
    textKey: "text" | "what" = "text",
  ) {
    if (!entry?.quote) return;
    const value = entry[textKey];
    fields.push({
      path: `${path}.quote`,
      yamlPath: [...yamlPath, "quote"],
      quote: entry.quote,
      text: value === undefined ? undefined : { path: `${path}.${textKey}`, value },
    });
  }
  add(card.remind, "remind", ["remind"]);
  add(card.effect, "effect", ["effect"]);
  for (const [i, dose] of (card.dose ?? []).entries()) add(dose, `dose[${i}]`, ["dose", i], "what");
  for (const [i, step] of card.steps.entries()) {
    add(step, `steps.${step.id}`, ["steps", i]);
    add(step.duration, `steps.${step.id}.duration`, ["steps", i, "duration"]);
  }
  for (const [i, caution] of (card.cautions ?? []).entries()) add(caution, `cautions[${i}]`, ["cautions", i]);
  for (const [i, notice] of (card.notices ?? []).entries()) add(notice, `notices[${i}]`, ["notices", i]);
  add(card.duration, "duration", ["duration"]);
  for (const [name, variant] of Object.entries(card.variants ?? {})) {
    add(variant?.replace, `variants.${name}.replace`, ["variants", name, "replace"]);
  }
  for (const [i, segment] of (card.segments ?? []).entries()) {
    const path = `segments.${segment.id}`;
    add(segment.action, `${path}.action`, ["segments", i, "action"]);
    add(segment.dose, `${path}.dose`, ["segments", i, "dose"]);
    for (const [j, avoid] of (segment.avoid ?? []).entries()) {
      add(avoid, `${path}.avoid[${j}]`, ["segments", i, "avoid", j]);
    }
  }
  return fields;
}
