import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { DiscoverPanel } from "../../src/ui/DiscoverPanel.tsx";
import type { Card } from "../../src/domain/routine.ts";

function makeCard(): Card {
  return {
    id: "a",
    status: "reviewed",
    source: { anchor: "a" },
    remind: { text: "做 a", quote: "做 a" },
    steps: [],
  };
}

describe("发现区的标题层级", () => {
  it("发现是今天页的二级标题，不让 h1 直接跳到 h3", () => {
    const html = render(
      <DiscoverPanel
        picks={[makeCard()]}
        names={new Map([["a", "做 a"]])}
        pool={1}
        mode="normal"
        tags={[]}
        onAdd={() => {}}
        onNext={() => {}}
      />,
    );
    expect(html).toContain("<h2>发现</h2>");
  });
});
