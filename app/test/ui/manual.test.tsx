/**
 * 手册浏览的组件渲染。
 *
 * 关心三件事：文章列得出来、正文（连小节与图片）读得到、
 * 疾病类的固定提示与分级提示该在的地方在（尤其 seek-care 收起态就要看得见）。
 *
 * 用 preact-render-to-string：不需要浏览器，组件级渲染就足够断言。
 */
import { describe, expect, it } from "vitest";
// 用具名导出：包的 .d.ts 是 CJS 风格，default 导入在类型上会被当成模块对象。
import { render } from "preact-render-to-string";

import { ArticleView, Manual } from "../../src/ui/Manual.tsx";
import type { ManualArticle } from "../../src/domain/manual.ts";
import type { Card } from "../../src/domain/routine.ts";

const BANNER = "本页是疾病知识，不是治疗方案；调整饮食、用药前请咨询医生。";

function makeArticle(over: Partial<ManualArticle> = {}): ManualArticle {
  return {
    path: "body-care/tears.md",
    title: "睑缘清洗",
    sections: [
      { heading: "睑缘清洗", md: "眼睛总觉得干涩" },
      {
        heading: "做法：每天 10 秒",
        md: "用温水打湿指尖\n\n![动作说明](/media/abc.png)",
      },
    ],
    ...over,
  };
}

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "tears",
    status: "reviewed",
    source: { anchor: "睑缘清洗" },
    remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘" },
    steps: [],
    ...over,
  };
}

describe("手册列表", () => {
  it("列出全部文章", () => {
    const articles = [
      makeArticle({ path: "body-care/a.md", title: "睑缘清洗" }),
      makeArticle({ path: "life-hacks/b.md", title: "血管拉伸" }),
    ];
    const html = render(<Manual articles={articles} cards={[]} path={null} onPath={() => {}} />);
    expect(html).toContain("睑缘清洗");
    expect(html).toContain("血管拉伸");
    expect(html).toContain("2 篇");
  });

  it("全文没到时先用目录画列表，不等 manual.json", () => {
    const index = [
      { path: "body-care/a.md", title: "睑缘清洗" },
      { path: "life-hacks/b.md", title: "血管拉伸" },
    ];
    const html = render(
      <Manual articles={[]} index={index} cards={[]} path={null} onPath={() => {}} />,
    );
    expect(html).toContain("睑缘清洗");
    expect(html).toContain("血管拉伸");
    expect(html).toContain("2 篇");
    expect(html).not.toContain("加载中…");
  });

  it("打开文章时全文没到：先给标题与加载提示，不换错误页", () => {
    const html = render(
      <Manual
        articles={[]}
        index={[{ path: "body-care/a.md", title: "睑缘清洗" }]}
        cards={[]}
        path="body-care/a.md"
        onPath={() => {}}
      />,
    );
    expect(html).toContain("睑缘清洗");
    expect(html).toContain("正在加载这一篇…");
    expect(html).not.toContain("手册没加载出来");
  });

  it("有上一篇可回时，加载中的返回键也写上一篇", () => {
    const html = render(
      <Manual
        articles={[]}
        index={[{ path: "body-care/a.md", title: "睑缘清洗" }]}
        cards={[]}
        path="body-care/a.md"
        hasArticleHistory
        onPath={() => {}}
        onArticleBack={() => {}}
      />,
    );
    expect(html).toMatch(/>\s*上一篇\s*</);
    expect(html).not.toMatch(/>\s*手册\s*</);
  });

  it("手册内容在 main 地标里", () => {
    const html = render(
      <Manual articles={[makeArticle()]} cards={[]} path={null} onPath={() => {}} />,
    );
    expect(html).toContain('<main class="lg-shell">');
  });

  it("快照的 README 是目录页，不当文章铺出来", () => {
    const articles = [
      makeArticle({ path: "README.md", title: "精致生活" }),
      makeArticle({ path: "body-care/tears.md", title: "睑缘清洗" }),
    ];
    const html = render(<Manual articles={articles} cards={[]} path={null} onPath={() => {}} />);
    expect(html).not.toContain("精致生活");
    expect(html).toContain("1 篇");
  });

  it("有搜索框", () => {
    const html = render(<Manual articles={[makeArticle()]} cards={[]} path={null} onPath={() => {}} />);
    expect(html).toContain("搜标题或正文");
  });

  it("没有文章时给出提示", () => {
    const html = render(<Manual articles={[]} cards={[]} path={null} onPath={() => {}} />);
    expect(html).toContain("没有匹配的文章");
  });

  it("读不到 manual.json 时给人能照做的提示，不是开发者命令", () => {
    const html = render(
      <Manual
        articles={[]}
        cards={[]}
        error="读不到 manual.json（HTTP 404）。"
        path={null}
        onPath={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("手册没加载出来");
    expect(html).toContain("重试");
    expect(html).not.toContain("npm run content:build");
  });
});

describe("文章页", () => {
  it("动作卡前有二级标题，展开后的小节标题不跳级", () => {
    const html = render(
      <ArticleView
        article={makeArticle()}
        cards={[makeCard({ articlePath: "body-care/tears.md" })]}
        onBack={() => {}}
      />,
    );
    expect(html).toContain('<h2 class="lg-sr-only">能照着做的动作</h2>');
  });

  it("显示各小节的标题、正文与图片", () => {
    const html = render(
      <ArticleView article={makeArticle()} cards={[]} onBack={() => {}} />,
    );
    expect(html).toContain("做法：每天 10 秒");
    expect(html).toContain("用温水打湿指尖");
    expect(html).toContain("/media/abc.png");
  });

  it("有上一篇时返回键写上一篇，没有时写手册", () => {
    const previous = render(
      <ArticleView article={makeArticle()} cards={[]} hasPrevious onBack={() => {}} />,
    );
    expect(previous).toMatch(/>\s*上一篇\s*</);
    expect(previous).not.toMatch(/>\s*手册\s*</);

    const list = render(
      <ArticleView article={makeArticle()} cards={[]} onBack={() => {}} />,
    );
    expect(list).toMatch(/>\s*手册\s*</);
  });

  it("一篇里有多个未加入的动作时，提供整套加入", () => {
    const html = render(
      <ArticleView
        article={makeArticle()}
        cards={[
          makeCard({ id: "a", articlePath: "body-care/tears.md", name: "动作甲" }),
          makeCard({ id: "b", articlePath: "body-care/tears.md", name: "动作乙" }),
          makeCard({ id: "c", articlePath: "body-care/tears.md", name: "动作丙" }),
        ]}
        routineIds={["a"]}
        onBack={() => {}}
        onAddToRoutine={() => {}}
        onAddManyToRoutine={() => {}}
      />,
    );
    expect(html).toContain("把这一篇的 2 个动作一起放进日常");
    expect(html).toContain("已在日常");
    expect(html).toContain("放进日常");
  });

  it("文章标题只出现一次（第一小节标题与标题相同时不重复）", () => {
    const html = render(
      <ArticleView article={makeArticle()} cards={[]} onBack={() => {}} />,
    );
    expect(html.match(/睑缘清洗/g)?.length).toBe(1);
  });
});

describe("疾病类", () => {
  const conditionCard = makeCard({
    id: "glaucoma",
    articleKind: "condition",
    articlePath: "the-savvy-life-manual/condition/glaucoma.md",
    notices: [
      { level: "info", text: "一般知识一条", quote: "一般知识一条" },
      { level: "with-doctor", text: "调整饮食需遵医嘱", quote: "调整饮食需遵医嘱" },
      { level: "seek-care", text: "出现眼痛要就医", quote: "出现眼痛要就医" },
    ],
  });

  const conditionArticle = makeArticle({
    path: "condition/glaucoma.md",
    title: "青光眼",
    kind: "condition",
    sections: [{ heading: "青光眼", md: "眼压高" }],
  });

  it("疾病文章页首有固定提示", () => {
    const html = render(
      <ArticleView
        article={conditionArticle}
        cards={[conditionCard]}
        onBack={() => {}}
      />,
    );
    expect(html).toContain(BANNER);
  });

  it("普通文章没有那条提示", () => {
    const html = render(
      <ArticleView article={makeArticle()} cards={[]} onBack={() => {}} />,
    );
    expect(html).not.toContain(BANNER);
  });

  it("seek-care 收起态就看得见，其余分级在展开态", () => {
    const html = render(
      <ArticleView
        article={conditionArticle}
        cards={[conditionCard]}
        onBack={() => {}}
      />,
    );
    expect(html).toContain("出现眼痛要就医");
    // 收起态不塞一般知识与遵医嘱提示
    expect(html).not.toContain("一般知识一条");
    expect(html).not.toContain("调整饮食需遵医嘱");
  });

  it("疾病卡不可勾选", () => {
    const html = render(
      <ArticleView
        article={conditionArticle}
        cards={[conditionCard]}
        onBack={() => {}}
      />,
    );
    expect(html).not.toContain("标记完成");
  });
});
