import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { Disclaimer } from "../../src/ui/Disclaimer.tsx";

describe("保健免责声明", () => {
  it("说清是生活参考、不替代医生诊断", () => {
    const html = render(<Disclaimer />);
    expect(html).toContain("生活参考");
    expect(html).toContain("不替代医生诊断");
    expect(html).toContain("咨询医生");
  });
});
