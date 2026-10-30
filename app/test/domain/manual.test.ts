/**
 * 手册的「找得到」这一面。
 *
 * 两条都是实测撞出来的：快照根下混着一个 README（目录页，约 1.9 万字），
 * 而卡片带的 articlePath 比手册的 path 多一层目录前缀。
 */
import { describe, expect, it } from "vitest";

import {
  buildCardNameIndex,
  findArticle,
  listableArticles,
  searchArticles,
  searchIndexByTitle,
  searchSummary,
  type ManualArticle,
} from "../../src/domain/manual.ts";
import { plainText } from "../../src/domain/notices.ts";
import type { Card } from "../../src/domain/routine.ts";

function a(path: string, title = path): ManualArticle {
  return { path, title, sections: [] };
}

describe("列表只放文章", () => {
  it("快照的 README 不算一篇", () => {
    const got = listableArticles([a("README.md"), a("body-care/tears.md")]);
    expect(got.map((x) => x.path)).toEqual(["body-care/tears.md"]);
  });

  it("四个目录下的都留下", () => {
    const all = [
      "body-care/x.md",
      "food/y.md",
      "mind-growth/z.md",
      "life-hacks/w.md",
    ].map((p) => a(p));
    expect(listableArticles(all)).toHaveLength(4);
  });
});

describe("卡片跳回它出自的那一篇", () => {
  const articles = [a("body-care/tears.md", "干眼症")];

  it("articlePath 带着 the-savvy-life-manual/ 前缀也要找得到", () => {
    const hit = findArticle(articles, "the-savvy-life-manual/body-care/tears.md");
    expect(hit?.title).toBe("干眼症");
  });

  it("不带前缀同样找得到", () => {
    expect(findArticle(articles, "body-care/tears.md")?.title).toBe("干眼症");
  });

  it("找不到返回 null，不拿第一篇糊弄", () => {
    expect(findArticle(articles, "food/egg.md")).toBeNull();
  });
});

describe("搜索结果的计数", () => {
  it("没有筛选时显示总数", () => {
    expect(searchSummary("", "all", 113, 113)).toBe("113 篇");
  });

  it("搜索时显示找到多少", () => {
    expect(searchSummary("膝盖", "all", 113, 14)).toBe("找到 14 篇（共 113 篇）");
  });

  it("只选分类也算筛选", () => {
    expect(searchSummary("", "body", 113, 62)).toBe("找到 62 篇（共 113 篇）");
  });
});

describe("全文没到时的标题搜索", () => {
  const index = [
    { path: "body-care/a.md", title: "蛋白质怎么吃" },
    { path: "body-care/b.md", title: "膝盖疼怎么办" },
  ];

  it("按标题找，多个词要同时命中", () => {
    expect(searchIndexByTitle(index, "蛋白").map((a) => a.path)).toEqual([
      "body-care/a.md",
    ]);
    expect(searchIndexByTitle(index, "蛋白 膝盖")).toEqual([]);
  });

  it("空查询原样返回", () => {
    expect(searchIndexByTitle(index, "  ")).toEqual(index);
  });
});

describe("按卡名也能搜到那一篇", () => {
  // 实测：卡名是内容层起的策展名，原文里未必有那个词 ——
  // 「晨光」在快照正文里一次都没出现，只在目录页。
  // 用户在「今天」页看到它，到手册里却搜不到：搜索在自己的词汇表上失灵了。
  const cards = [
    {
      id: "morning-light",
      name: "起床后晒 15 分钟晨光",
      articlePath: "the-savvy-life-manual/body-care/sleep.md",
    },
  ] as unknown as Card[];
  const article: ManualArticle = {
    path: "body-care/sleep.md",
    title: "睡不好？强光 + 睡前洗鼻",
    sections: [{ heading: "强光", md: "照够 2500 Lux。" }],
  };

  it("索引里带上这一篇的卡名", () => {
    const index = buildCardNameIndex(cards);
    expect(index.get("body-care/sleep.md")).toEqual(["起床后晒 15 分钟晨光"]);
  });

  it("全文没到时也能按卡名搜到", () => {
    const index = buildCardNameIndex(cards);
    const hits = searchIndexByTitle([article], "晨光", index);
    expect(hits.map((x) => x.path)).toEqual(["body-care/sleep.md"]);
  });

  it("全文到了也一样能搜到", () => {
    const index = buildCardNameIndex(cards);
    const hits = searchArticles([article], "晨光", index);
    expect(hits.map((x) => x.path)).toEqual(["body-care/sleep.md"]);
  });

  it("没给索引时行为不变（只搜标题与正文）", () => {
    expect(searchIndexByTitle([article], "晨光")).toHaveLength(0);
  });
});

describe("正文里的排版记号", () => {
  it("剥掉脚注记号，正文逐字不动", () => {
    const src = "滴眼药水的姿势也一并纠正。^[「涙」のトリセツ]";
    expect(plainText(src)).toBe("滴眼药水的姿势也一并纠正。");
  });

  it("不吞正文里的方括号内容", () => {
    const src = "水温控制在 32～34℃ [注：用手背试] 即可";
    expect(plainText(src)).toContain("[注：用手背试]");
  });
});
