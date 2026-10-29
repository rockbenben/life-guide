/**
 * 手册浏览：113 篇可读全文（快照 114 个 md 里含目录页）+ 疾病提示。
 *
 * 疾病类卡片只出现在这里（AGENTS.md §5.4）：不进今日清单、不可勾选，
 * 页首固定挂一条提示 —— 这一页是知识，不是治疗方案。
 *
 * 排法按「找得到」来：先按快照的四个目录分成四类，再叠搜索；
 * 每篇标出「N 个动作能照着做」—— 这一页不只是读，还要能跳回能做的东西。
 */
import { useEffect, useMemo, useState } from "preact/hooks";

import { CardView } from "./Card.tsx";
import { useConditions } from "./Conditions.tsx";
import type { Card } from "../domain/routine.ts";
import type { ManualArticle, ManualIndexEntry } from "../domain/manual.ts";
import { displayNames } from "../domain/lines.ts";
import { isConditionCard } from "../domain/notices.ts";
import {
  CATEGORIES,
  buildCardNameIndex,
  cardsOfArticle,
  categoryOf,
  filterByCategory,
  findArticle,
  listableArticles,
  renderSections,
  searchArticles,
  searchIndexByTitle,
  searchSummary,
} from "../domain/manual.ts";

export interface ManualProps {
  /** 全文（manual.json）。第一次进手册时可能还没取 —— 列表先用 index 画。 */
  articles: ManualArticle[];
  /** 目录（cards.json 里的 articles）：path/title/kind，够画列表。 */
  index?: ManualIndexEntry[];
  cards: Card[];
  loading?: boolean;
  error?: string | null;
  /** 全文加载状态：idle 表示还没请求，loaded 才搜得了正文 */
  manualState?: "idle" | "loading" | "loaded" | "error";
  /** 打开哪一篇由上层拿着：今天页展开态里的「出自」要能跳进来 */
  path: string | null;
  /** 从文章内链跳进来时要落到的小节标题 */
  anchor?: string;
  onPath: (path: string | null) => void;
  /** 文章内链：在应用里打开另一篇（可带小节锚点） */
  onOpenArticle?: (path: string, anchor?: string) => void;
  /** 文章页的返回：回上一篇（有内链历史时），否则回列表 */
  onArticleBack?: () => void;
  /** 有没有上一篇可回 —— 返回键据此写「上一篇」还是「手册」 */
  hasArticleHistory?: boolean;
  /** 「我的日常」里已有的卡 id —— 手册里那些卡要标出「已在日常」 */
  routineIds?: string[];
  /** 把一张卡放进「我的日常」 */
  onAddToRoutine?: (cardId: string) => void;
  /** 把这一篇里还没加入的动作一次加入 */
  onAddManyToRoutine?: (cardIds: string[]) => void;
  /** 撤销刚才的一次批量加入：只移除那一次加入的卡 */
  onRemoveManyFromRoutine?: (cardIds: string[]) => void;
  /** 需要全文时向上要（打开文章 / 搜正文）。重复调用由上层去重。 */
  onNeedManual?: () => void;
  /** 手册没加载出来时重新取一次（不刷新整页） */
  onRetry?: () => void;
}

export function Manual({
  articles,
  index,
  cards,
  loading,
  error,
  manualState,
  path,
  anchor,
  onPath,
  onOpenArticle,
  onArticleBack,
  hasArticleHistory,
  routineIds,
  onAddToRoutine,
  onAddManyToRoutine,
  onRemoveManyFromRoutine,
  onNeedManual,
  onRetry,
}: ManualProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  // 文章里的动作卡也要用同一套人群标签：否则读者在手册里看到「踮脚」，
  // 加入日常却变成「深蹲」，同一张卡两种动作。
  const cond = useConditions();

  // 快照根下的 README 是目录页，不当文章铺出来。
  // 有目录就用目录（不必等全文）；测试/旧调用只给了 articles 时退回全文。
  const pieces = useMemo(
    () => listableArticles(index && index.length ? index : articles),
    [index, articles],
  );
  const fullLoaded = articles.length > 0;
  // 卡名索引：用户在「今天」页看到的词，手册里也要搜得到
  // （卡名是内容层起的策展名，原文里未必有那个词）
  const nameIndex = useMemo(() => buildCardNameIndex(cards), [cards]);
  const found = useMemo(
    () =>
      filterByCategory(
        fullLoaded
          ? searchArticles(listableArticles(articles), query, nameIndex)
          : searchIndexByTitle(pieces, query, nameIndex),
        category,
      ),
    [fullLoaded, articles, pieces, query, category, nameIndex],
  );
  // 全文还在路上：标题没命中不等于「没有这篇文章」，别先报空结果。
  const awaitingBody =
    !fullLoaded && (manualState === "loading" || manualState === "idle");
  const open = path ? findArticle(articles, path) : null;
  const openIndex = path
    ? (index ?? articles).find(
        (a) => a.path === path || path.endsWith("/" + a.path),
      )
    : null;

  // 打开文章 / 搜正文才要全文 —— 列目录不花这 800 KB。
  useEffect(() => {
    if (path && !open) onNeedManual?.();
  }, [path, open, onNeedManual]);
  useEffect(() => {
    if (query.trim() && !fullLoaded) onNeedManual?.();
  }, [query, fullLoaded, onNeedManual]);

  // 打开文章要回到顶部：列表可能已经滚到很下面，直接换内容的话
  // 用户会落在文章中段，看不到标题和那条「不是治疗方案」的提示。
  useEffect(() => {
    if (path) window.scrollTo(0, 0);
  }, [path]);

  // 每篇文章底下抽了几张卡 —— 列表里直接写出来，就知道哪篇能照着做
  const cardCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of pieces) m.set(a.path, cardsOfArticle(cards, a.path).filter((c) => !isConditionCard(c)).length);
    return m;
  }, [pieces, cards]);


  const cats = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        count: filterByCategory(pieces, c.id).length,
      })).filter((c) => c.count > 0),
    [pieces],
  );

  if (loading) {
    return (
      <main class="lg-shell">
        <h1 class="lg-h1">手册</h1>
        <p class="lg-do">加载中…</p>
      </main>
    );
  }

  // 打开了一篇、但全文还没到（或读不到）：先给标题和一条回去的路。
  // 目录仍然可用，不能因为一篇文章没加载出来就把整页换成错误页。
  if (path && !open) {
    return (
      <main class="lg-shell">
        <div class="lg-read">
          <button
            class="lg-back"
            aria-label={hasArticleHistory ? "回到上一篇" : "回到手册列表"}
            onClick={() => (onArticleBack ?? (() => onPath(null)))()}
          >
            <svg class="lg-icon" style="margin-top:0" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M10 2.5 4.5 8 10 13.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {hasArticleHistory ? "上一篇" : "手册"}
          </button>
          <h1 class="lg-h1">{openIndex?.title ?? "手册"}</h1>
          {error ? (
            <>
              <p class="lg-alert-error">这一篇没加载出来。</p>
              <p class="lg-pool">可能是网络断了。点「重试」再试一次。</p>
              {onRetry ? (
                <div class="lg-btn-row" style="margin-top:12px">
                  <button class="lg-btn" onClick={onRetry}>
                    重试
                  </button>
                </div>
              ) : null}
              <p class="lg-pool" style="font-size:var(--lg-t1)">{error}</p>
            </>
          ) : fullLoaded ? (
            <p class="lg-do">这篇不在手册里，回去换一篇吧。</p>
          ) : (
            <p class="lg-do">正在加载这一篇…</p>
          )}
        </div>
      </main>
    );
  }

  // 旧产物没有目录：先等全文，别把「还在加载」画成「没有匹配」。
  if (!pieces.length && (manualState === "loading" || manualState === "idle")) {
    return (
      <main class="lg-shell">
        <h1 class="lg-h1">手册</h1>
        <p class="lg-do">加载中…</p>
      </main>
    );
  }

  // 连目录都没有（旧产物 / 第一次就失败）：没有东西可画，只能给错误页。
  if (error && !pieces.length) {
    return (
      <main class="lg-shell">
        <h1 class="lg-h1">手册</h1>
        <p class="lg-alert-error">手册没加载出来。</p>
        <p class="lg-pool">可能是网络断了。点「重试」再试一次。</p>
        {onRetry ? (
          <div class="lg-btn-row" style="margin-top:12px">
            <button class="lg-btn" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : null}
        {/* 技术细节给开发者看（普通用户不看这一行） */}
        <p class="lg-pool" style="font-size:var(--lg-t1)">{error}</p>
      </main>
    );
  }

  if (open) {
    return (
      <ArticleView
        article={open}
        cards={cards}
        userTags={cond.tags}
        anchor={anchor}
        hasPrevious={hasArticleHistory}
        onBack={() => (onArticleBack ?? (() => onPath(null)))()}
        onOpenArticle={onOpenArticle ?? onPath}
        routineIds={routineIds}
        onAddToRoutine={onAddToRoutine}
        onAddManyToRoutine={onAddManyToRoutine}
        onRemoveManyFromRoutine={onRemoveManyFromRoutine}
      />
    );
  }

  return (
    <main class="lg-shell">
      <div class="lg-topbar">
        <h1 class="lg-h1">手册</h1>
        <span class="lg-dateline tabular">
          {searchSummary(query, category, pieces.length, found.length)}
        </span>
      </div>

      <div class="lg-searchwrap">
        <input
          class="lg-search"
          type="search"
          placeholder="搜标题或正文，也可搜动作名"
          aria-label="搜索手册"
          value={query}
          onFocus={() => onNeedManual?.()}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        {/* 自己画清除键：浏览器原生那颗只有 9×7px，颜色还不算令牌表里的。 */}
        {query ? (
          <button
            class="lg-searchclear"
            onClick={() => setQuery("")}
            aria-label="清空搜索"
            title="清空搜索"
          >
            ×
          </button>
        ) : null}
      </div>

      {query.trim() && !fullLoaded ? (
        <p class="lg-pool" role="status">
          {manualState === "error"
            ? "全文没加载出来，先按标题找；"
            : "正文还在加载，先按标题找；加载完会自动补上正文匹配。"}
          {manualState === "error" && onRetry ? (
            <button class="lg-linkbtn" onClick={onRetry}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}

      <div class="lg-cats" role="group" aria-label="分类">
        {cats.map((c) => (
          <button
            key={c.id}
            class="lg-cat"
            aria-pressed={c.id === category}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
            <span class="tabular">{c.count}</span>
          </button>
        ))}
      </div>

      {found.length === 0 ? (
        awaitingBody ? null : (
          <div class="lg-empty">
            <h2>没有匹配的文章</h2>
            <p>换个词试试，或者点上面的分类翻。</p>
            <div class="lg-btn-row">
              <button
                class="lg-btn lg-btn-ghost"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                {category === "all" ? "清空搜索" : "清掉筛选"}
              </button>
            </div>
          </div>
        )
      ) : (
        <ul class="lg-arts">
          {found.map((a) => (
            <li key={a.path}>
              <button class="lg-art" onClick={() => onPath(a.path)}>
                <span class="lg-art-t">{a.title}</span>
                <span class="lg-art-m">
                  {categoryOf(a.path) ? <span>{categoryOf(a.path)!.label}</span> : null}
                  {cardCounts.get(a.path) ? (
                    <span class="lg-badge" data-k="act">
                      {cardCounts.get(a.path)} 个动作能照着做
                    </span>
                  ) : null}
                  {a.kind === "condition" ? (
                    <span class="lg-badge" data-k="cond">疾病知识</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export interface ArticleViewProps {
  article: ManualArticle;
  cards: Card[];
  userTags?: string[];
  /** 从内链跳进来时要落到的小节标题 */
  anchor?: string;
  /** 有上一篇可回：返回键写「上一篇」，否则写「手册」 */
  hasPrevious?: boolean;
  onBack: () => void;
  onOpenArticle?: (path: string, anchor?: string) => void;
  /** 「我的日常」里已有的卡 id —— 标出「已在日常」 */
  routineIds?: string[];
  /** 把一张卡放进「我的日常」 */
  onAddToRoutine?: (cardId: string) => void;
  /** 把这一篇里还没加入的动作一次加入 */
  onAddManyToRoutine?: (cardIds: string[]) => void;
  /** 撤销刚才的一次批量加入：只移除那一次加入的卡 */
  onRemoveManyFromRoutine?: (cardIds: string[]) => void;
}

export function ArticleView({
  article,
  cards,
  userTags = [],
  anchor,
  hasPrevious,
  onBack,
  onOpenArticle,
  routineIds,
  onAddToRoutine,
  onAddManyToRoutine,
  onRemoveManyFromRoutine,
}: ArticleViewProps) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [bulkNote, setBulkNote] = useState("");
  /** 这一次批量加入的卡：撤销只退回这一批，不碰用户原有的日常 */
  const [bulkAdded, setBulkAdded] = useState<string[]>([]);

  // 展开卡片、批量加入的提示都会重渲染本组件；不 memo 的话每次都要重解析全文 markdown
  const sections = useMemo(() => renderSections(article), [article]);

  useEffect(() => {
    setBulkNote("");
    setBulkAdded([]);
  }, [article.path]);

  useEffect(() => {
    if (!anchor) return;
    const raf = requestAnimationFrame(() => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(".lg-read h2, .lg-read h3"),
      );
      const hit =
        nodes.find((n) => n.textContent?.trim() === anchor) ??
        nodes.find((n) => n.textContent?.includes(anchor));
      hit?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [article.path, anchor]);
  /**
   * 编号只数「有标题的小节」。
   *
   * 第一节的标题就是篇名（renderSections 把它的 heading 置空，免得标题显示两遍），
   * 要是还按原序号排，第一个看到的编号会是 02 —— 像是漏了一节。
   */
  let secNo = 0;
  const numbered = sections.map((s) => ({ s, no: s.heading ? ++secNo : 0 }));
  const articleCards = cardsOfArticle(cards, article.path);
  const conditionCards = articleCards.filter(isConditionCard);
  // 疾病类文章（以及挂着疾病卡的文章）页首必须挂提示：
  // 手册里写的是知识，不是治疗方案，照着改饮食改用药是要出事的。
  const isCondition = article.kind === "condition" || conditionCards.length > 0;
  const practiceCards = articleCards.filter((c) => !isConditionCard(c));
  const bulkIds = practiceCards
    .filter((c) => !routineIds?.includes(c.id))
    .map((c) => c.id);
  // 屏上叫什么：一个小节拆出多张卡时名字会撞车，回落到这张卡在做什么
  const names = useMemo(() => displayNames(cards), [cards]);

  return (
    <main class="lg-shell">
      <div
        class="lg-read"
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest("a[data-article]");
          if (!a) return;
          e.preventDefault();
          const path = a.getAttribute("data-article");
          if (path) onOpenArticle?.(path, a.getAttribute("data-anchor") ?? undefined);
        }}
      >
        <button
          class="lg-back"
          aria-label={hasPrevious ? "回到上一篇" : "回到手册列表"}
          onClick={onBack}
        >
          <svg class="lg-icon" style="margin-top:0" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M10 2.5 4.5 8 10 13.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {hasPrevious ? "上一篇" : "手册"}
        </button>
        <h1 class="lg-h1">{article.title}</h1>

        {isCondition ? (
          <p class="lg-disclaim">
            本页是疾病知识，不是治疗方案；调整饮食、用药前请咨询医生。
          </p>
        ) : null}

        {practiceCards.length ? (
          <div class="lg-log lg-actions" style="margin-top:18px">
            {/* 展开卡里的小节标题是 h3；这里补一个给读屏的 h2，别让 h1 直接跳到 h3。 */}
            <h2 class="lg-sr-only">能照着做的动作</h2>
            {/* 这一排是什么，得说清楚 —— 不然它像文章的一部分，而不是「能做的事」 */}
            <p class="lg-pool" style="margin:0 0 2px">
              这一篇能照着做 {practiceCards.length} 个动作。点
              <span class="lg-nb">「放进日常」</span>，以后它就在今天页里。
            </p>
            {bulkIds.length >= 2 && onAddManyToRoutine ? (
              <div class="lg-btn-row" style="margin:8px 0 4px">
                <button
                  class="lg-btn"
                  onClick={() => {
                    onAddManyToRoutine(bulkIds);
                    setBulkAdded(bulkIds);
                    setBulkNote(`已把 ${bulkIds.length} 个动作一起放进日常。`);
                  }}
                >
                  把这一篇的 {bulkIds.length} 个动作一起放进日常
                </button>
              </div>
            ) : null}
            {bulkNote ? (
              <p class="lg-pool" role="status">
                {bulkNote}
                {bulkAdded.length && onRemoveManyFromRoutine ? (
                  <button
                    class="lg-linkbtn"
                    style="margin-left:8px"
                    onClick={() => {
                      onRemoveManyFromRoutine(bulkAdded);
                      setBulkAdded([]);
                      setBulkNote("已撤销，刚才加入的动作已移出日常。");
                    }}
                  >
                    撤销
                  </button>
                ) : null}
              </p>
            ) : null}
            {practiceCards.map((c) => (
              // data-card-unit：这一张卡的范围连着下面那颗「放进日常」——
              // 点它不算「点了别处」，否则正看着卡却被收起来。
              <div key={c.id} data-card-unit={c.id}>
                <CardView
                  card={c}
                  mode="normal"
                  userTags={userTags}
                  done={false}
                  streakDays={0}
                  expanded={expandedCard === c.id}
                  onExpand={() =>
                    setExpandedCard(expandedCard === c.id ? null : c.id)
                  }
                  onToggle={() => {}}
                  readOnly
                  displayName={names.get(c.id)}
                  articleTitle={article.title}
                />
                {/* 手册是「找到能做的事」的地方 —— 找到之后得能放进去，
                    否则这一页是个只读的死胡同（发现那边一天只轮到 3 张）。 */}
                {onAddToRoutine ? (
                  <div class="lg-btn-row" style="margin:0 0 6px">
                    {routineIds?.includes(c.id) ? (
                      <span class="lg-added">已在日常</span>
                    ) : (
                      <button
                        class="lg-btn lg-btn-ghost"
                        onClick={() => onAddToRoutine(c.id)}
                      >
                        放进日常
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {conditionCards.length ? (
          <div class="lg-log lg-actions" style="margin-top:18px">
            <h2 class="lg-sr-only">疾病知识卡片</h2>
            {conditionCards.map((c) => (
              <CardView
                key={c.id}
                card={c}
                mode="normal"
                userTags={userTags}
                done={false}
                streakDays={0}
                expanded={expandedCard === c.id}
                onExpand={() =>
                  setExpandedCard(expandedCard === c.id ? null : c.id)
                }
                onToggle={() => {}}
                readOnly
                displayName={names.get(c.id)}
                articleTitle={article.title}
              />
            ))}
          </div>
        ) : null}

        {numbered.map(({ s, no }, i) => (
          <section key={i}>
            {s.heading ? (
              <div class="lg-sec-h">
                <span class="lg-num">{String(no).padStart(2, "0")}</span>
                <h2>{s.heading}</h2>
              </div>
            ) : null}
            {/* 正文是 markdown 渲染出来的（表格、图片、列表、加粗都在里面）。
                HTML 来自我们自己的快照，不是用户输入。 */}
            <div class="lg-md" dangerouslySetInnerHTML={{ __html: s.html }} />
          </section>
        ))}
      </div>
    </main>
  );
}
