/**
 * 人工裁定过的步级时长。
 *
 * 为什么要有这份清单：机器判不准「一句里两个时长」时该取哪个
 * （「抬起单脚保持 10 秒，然后放下休息 3 秒」—— 这一步是 10 秒还是 13 秒？）
 * 与「该不该有时长」（「速走 1 分钟 = 半格」是换算，不是做法）。
 * 这两件事是**内容判断**，机器只能给候选 —— 裁定由人做，在这里留痕。
 *
 * 每条：
 *   id / step  —— 哪张卡的哪一步
 *   sec        —— 裁定为多少秒
 *   quote      —— 作证的引文（必须是快照的逐字子串，R1 会查）
 *   note       —— 为什么是这个数
 *
 * 不在清单里的步骤 = 不加步级时长。**没列进去不是错**：
 * 原文没给这一步多长时间的卡很多，逼着填就是编数（D7）。
 */

export interface Verdict {
  id: string;
  step: string;
  sec: number;
  quote: string;
  approximate?: boolean;
  note: string;
}

export const STEP_DURATION_VERDICTS: Verdict[] = [
  {
    id: "daily-frailty-exercise-selection",
    step: "thigh-hip-strength",
    sec: 2,
    quote:
      "一只脚向前迈出一步，上半身保持笔直，用 2 秒下沉；前脚位置不动，用 2 秒把上半身带回来；左右各 10 次。要点是膝盖不超过脚尖、双膝尽量保持 90 度、上半身不要前倾或后仰，前脚位置不移动、不往后撤。因为容易失去平衡，建议扶着椅子做。温柔版：坐在椅子上，把一条腿抬到离开椅面为止，用 2 秒抬起、2 秒放下，左右各 10 次；膝盖角度保持不变。",
    note: "一句里四个 2 秒（下去 2 秒、回来 2 秒、抬起 2 秒、放下 2 秒），都是同一个动作的节拍 —— 取 2 秒。",
  },
  {
    id: "daily-frailty-exercise-selection",
    step: "circling-balance",
    sec: 4,
    quote:
      "一只手扶在椅子等支撑物上，用与支撑手相反侧的脚，以 4 秒为一周慢慢地画一个大圆；画 4 圈，再反向画 4 圈；然后左右互换，重复同样的顺、逆时针各 4 圈。温柔版：把一只脚稍微向后抬起，做单脚站立 32 秒，换另一只脚再做 32 秒。",
    note: "「以 4 秒为一周」是这一步的节拍；温柔版的 32 秒是另一个版本（单脚站），不是这一步。",
  },
  {
    id: "daily-frailty-exercise-selection",
    step: "oral-gymnastics",
    sec: 8,
    quote:
      "把「パパパパ……」尽可能快、清晰地念 8 秒；「タタタタ……」念 8 秒；「カカカカ……」念 8 秒。「パ」锻炼吸吮、吞饮的肌力，「タ」锻炼把食物压碎的肌力，「カ」锻炼吞咽的肌力。",
    note: "三个 8 秒是同一步的三种念法，取 8 秒。",
  },
  {
    id: "daily-frailty-exercise-selection",
    step: "air-chair",
    sec: 32,
    quote:
      "坐在椅子上，做「快要站起来」的动作，把屁股稍微抬离椅面，保持 32 秒；然后坐回去休息 16 秒；再来一次 32 秒。要点：屁股抬得越低效果越好；不要憋气；大腿要用力；双脚朝向平行（内八和外八都不行）。膝盖疼时不要勉强。温柔版：坐在椅子上双手放在膝盖上，用 4 秒慢慢站起、再用 4 秒慢慢坐下，重复 10 次，尽量不用手撑、靠腿的力量站起来。",
    note: "主动作是「保持 32 秒」；16 秒是中间休息、4 秒是温柔版 —— 这一步是 32 秒。",
  },
  {
    id: "daily-frailty-exercise-selection",
    step: "cognitive-moving",
    sec: 60,
    quote:
      "脚步节奏是「1、2」向前迈一步，「3、4」向后退一步；边踩步边在向前迈出的那一步（图①）把答案念出声，图②③④的位置不出声。加法做 1 分钟、减法做 1 分钟。",
    note: "「加法做 1 分钟、减法做 1 分钟」—— 这一步整体 1 分钟。",
  },
  {
    id: "single-leg-stand",
    step: "single-leg-hold",
    sec: 30,
    quote: "保持 30 秒到 1 分钟，左右分别做",
    note: "原文给的是区间（30 秒到 1 分钟）。取下限 30 秒 —— 计时器宁可早提醒，让人自己判断，不替原文选上限。",
  },
  {
    id: "squat",
    step: "squat-chair",
    sec: 10,
    quote:
      "坐在椅子上做深蹲，臀部即将碰到椅面时保持 10 秒，保持 10 秒后站起来，重复深蹲",
    note: "两个 10 秒是同一句里的重复表述，取 10 秒。",
  },
  {
    id: "knee-pain-three-ways",
    step: "strength-lift-leg",
    sec: 10,
    quote:
      "抬起单脚保持 10 秒，然后放下休息 3 秒，注意让负荷落在大腿前侧。",
    note: "这一步是「抬起保持 10 秒」；3 秒是放下的休息，不是这一步。",
  },
  {
    id: "make-tender-chicken-breast",
    step: "marinate-chicken",
    sec: 1200,
    quote: "冷藏 20 分钟～1 小时",
    note: "原文是区间。取下限 20 分钟（1200 秒）—— 同 single-leg-stand 的取舍。",
  },
  {
    id: "asparagus-cooking-overview",
    step: "blanch-by-diameter",
    sec: 30,
    quote: "沸水下锅——直径 1～1.5cm 焯 20～30 秒、直径 1.5～2cm 焯 30～40 秒",
    note: "按直径分两档。取较细那档的上限 30 秒（较粗那档是另一个条件分支）。",
  },
  {
    id: "asparagus-cooking-overview",
    step: "sear-whole",
    sec: 180,
    quote: "油盐裹满全身，冷锅下，大火约 3 分钟全程不上色不翻动，出锅前翻面再加热约 30 秒",
    note: "主段是「大火约 3 分钟」；30 秒是翻面后再加热那一小段。",
    approximate: true,
  },
  {
    id: "asparagus-crisp-blanch",
    step: "choose-time-by-diameter",
    sec: 30,
    quote: "直径 1～1.5cm → 20～30 秒；直径 1.5～2cm → 30～40 秒",
    note: "同 blanch-by-diameter：取较细那档的上限 30 秒。",
  },
  {
    id: "burdock-beef-pasta",
    step: "pasta-add-sauce",
    sec: 120,
    quote: "加入①，继续用大火翻炒 1～2 分钟，再倒入 （A），再炒约 1 分钟；",
    note: "「翻炒 1～2 分钟」是主段（取上限 120 秒）；后面「再炒约 1 分钟」是收尾。",
  },
  {
    id: "blanched-sweet-cabbage",
    step: "blanch-one-more-minute",
    sec: 60,
    quote: "再焯 1 分钟，把剩下的叶片也取出，放进 30 秒冷水里浸泡去咸。沥干即可上桌。",
    note: "这一步是「再焯 1 分钟」；30 秒是之后的冷水浸泡。",
  },
  {
    id: "mackerel-tebo-nabe",
    step: "cook-nabe-body",
    sec: 420,
    quote: "煎锅里放入除韭菜和芝麻油以外的全部材料，中火煮约 7 分钟；加入韭菜再加热 1 分钟，关火后加芝麻油。",
    note: "主体是「中火煮约 7 分钟」；加韭菜后那 1 分钟是收尾。",
    approximate: true,
  },
  {
    id: "mackerel-tebo-nabe",
    step: "add-chives-and-oil",
    sec: 60,
    quote: "煎锅里放入除韭菜和芝麻油以外的全部材料，中火煮约 7 分钟；加入韭菜再加热 1 分钟，关火后加芝麻油。",
    note: "这一步是「加入韭菜再加热 1 分钟」（前一步是煮 7 分钟主体）。原文这半句没有「约」—— 近似词贴着的是前半句的 7 分钟，所以这里不标 approximate。",
  },
  {
    id: "grilled-chicken-skewers",
    step: "pan-sear-skewers",
    sec: 180,
    quote: "平底锅倒油，鸡胸皮朝下煎 3 分钟，上色后翻面再煎 2 分钟。",
    note: "先煎 3 分钟上色是主段；翻面再煎 2 分钟是第二面。",
  },
  {
    id: "korean-grilled-chicken",
    step: "pan-cook-korean-chicken",
    sec: 180,
    quote: "平底锅倒橄榄油，鸡胸皮朝下中小火煎 3 分钟，翻面盖盖再煎 3 分钟。",
    note: "两个 3 分钟是对两面各一次，取第一个（这一步是「煎上色」那一面）。",
  },
  {
    id: "chocolate-seed-tempering",
    step: "home-melt",
    sec: 60,
    quote: "把 ① 用微波炉 500W 加热 1 分钟，轻轻搅拌。",
    note: "第一步是「加热 1 分钟」；后面「再用微波炉 500W 加热 30 秒」「加热不足时追加 10 秒」是后续的补热。",
  },
  {
    id: "lightly-dry-radish",
    step: "oven-dry-radish",
    sec: 2700,
    quote: "换烤箱也可以：110℃ 加热 45 分钟～1 小时",
    note: "原文是区间。取下限 45 分钟（2700 秒）。",
  },
  {
    id: "clam-chowder",
    step: "stir-fry-clams",
    sec: 60,
    quote:
      "加入冻蛤蜊，强火快炒约 1 分钟（略不足 1 分钟）。注意：口还没合上的蛤蜊不能吃。",
    note: "「约 1 分钟（略不足 1 分钟）」—— 原文自己说了不足，取 60 秒。",
    approximate: true,
  },
  {
    id: "tempura-recipe",
    step: "tempura-fry-to-target",
    sec: 180,
    quote: "炸制时间目标：蔬菜约 3 分钟，鱼贝类约 1 分～1 分 30 秒。",
    note: "目标里给的是两档（蔬菜 / 鱼贝类）。取蔬菜那档 3 分钟 —— 原文把蔬菜列在前。",
    approximate: true,
  },
  {
    id: "crispy-potatoes",
    step: "potato-final-fry",
    sec: 180,
    quote: "捞出静置约 3 分钟，再回锅用大火炸约 1 分钟，完成。",
    note: "这一步是「静置约 3 分钟」；回锅炸 1 分钟是紧接的另一段。",
    approximate: true,
  },
  {
    id: "four-ingredient-activation-switches",
    step: "roast-king-oyster-whole",
    sec: 600,
    quote:
      "杏鲍菇整根烤（整根 200℃ 烤 10 分钟，或切大块裹培根 200℃ 烤面包机 / 220℃ 烤箱烤 15～20 分钟）",
    note: "两个做法分支（整根 / 切大块）。取整根那档 10 分钟 —— 步骤名是「整根烤」。",
  },
  {
    id: "maple-seasoning-chawanmushi",
    step: "steam-chawanmushi",
    sec: 120,
    quote: "蒸锅上汽后放入，大火 2 分钟，再转小火约 10 分钟，出锅撒上三之叶。",
    note: "「大火 2 分钟」是这一步的起手段；转小火 10 分钟是接着蒸的那一段。",
  },
  {
    id: "steak-golden-juice",
    step: "steak-preheat",
    sec: 60,
    quote: "锅里放 2 大勺油，中火预热 1 分钟。肉要在烹饪前 20～30 分钟从冷藏取出回温。",
    note: "这一步是「中火预热 1 分钟」；20～30 分钟是**烹饪前**的回温，不是这一步。",
  },
  {
    id: "steak-golden-juice",
    step: "steak-rest",
    sec: 900,
    quote: "取出肉，用铝箔包住静置 15 分钟（1cm 厚静置 4 分钟，2cm 厚静置 8 分钟）。",
    note: "默认是静置 15 分钟；括号里的是按厚度的分档说明。",
  },
  {
    id: "steak-golden-juice",
    step: "steak-sear",
    sec: 30,
    quote: "加 1 大勺油，最后强火把两面各烤 30 秒～1 分钟，烤出你想要的香气，完成。",
    note: "原文是区间。取下限 30 秒（每面）。",
  },
  {
    id: "minced-meat-stock",
    step: "broth-simmer",
    sec: 300,
    quote: "再次沸腾前转小火，约 5 分钟；到时间后捞出绞肉，再煮约 5 分钟完成。",
    note: "两个「约 5 分钟」分别是绞肉段与再煮段；这一步取第一个 5 分钟。",
    approximate: true,
  },
  {
    id: "sauce-burst-miso-method-and-dishes",
    step: "cook-gratin",
    sec: 120,
    quote: "加培根、蘑菇、虾，中火翻炒，虾变色后加入面粉再炒 2 分钟。",
    note: "这一步是「加入面粉再炒 2 分钟」；10 分钟是最后烤箱那一段（另一张卡的步骤）。",
  },
  {
    id: "okara-crepe",
    step: "cook-crepe",
    sec: 120,
    quote: "弱火煎 1～2 分钟，然后翻面再煎约 1 分钟。",
    note: "「煎 1～2 分钟」是这一面（取上限 120 秒）；翻面那 1 分钟是另一面。",
  },
  {
    id: "make-okuda-tomato-sauce",
    step: "reduce-sauce",
    sec: 180,
    quote: "炒 3 分钟左右，达到「咕嘟咕嘟」的浓稠状态。不够浓稠：延长加热时间，或关火后前后各颠 20 秒。",
    note: "「炒 3 分钟左右」是收浓；20 秒是补救动作。",
    approximate: true,
  },
  {
    id: "ultra-slow-blink-four-steps",
    step: "blink-speed",
    sec: 3,
    quote: "速度：一次往返 3 秒。从闭眼到重新睁开算一次、算 3 秒。",
    note: "两个 3 秒是同一件事的两种说法。",
  },
];

/**
 * 明确**不加**步级时长的步（机器给过候选，人工判定不该加）。
 *
 * 记在这里是为了别过一阵又把它们捡回来 —— 每条都有理由。
 */
export const STEP_DURATION_REJECTED: { id: string; step: string; reason: string }[] = [
  {
    id: "brisk-walking-visual-tracker",
    step: "half-grid",
    reason: "「速走 1 分钟 = 半格」是**换算**（速走多久换几格），不是这一步做多久。",
  },
  {
    id: "throat-decline-check",
    step: "compare-reference",
    reason: "「男性 25 秒、女性 20 秒」是**衰退线参考值**，用来对照，不是做法。",
  },
  {
    id: "face-wash",
    step: "lather",
    reason: "「约 1 分 30 秒到 2 分钟搓出绵密的泡」是**整段泡沫的时间**，不是某个动作的时长；这一步是「搓到大致起泡」，没有单一读数。",
  },
  {
    id: "kiwi-shaved-ice",
    step: "thaw-if-too-hard",
    reason: "「放了超过 1 小时」「室温放约 20 分钟」是**条件分支**（冻硬了才回温），不是这一步本身的时长。",
  },
  {
    id: "steam-whole-vegetables",
    step: "adjust-heat",
    reason: "「炒菜等蒸完还要再加热：强火约 1 分钟；凉拌、焯水拌等蒸完就不再加热：强火约 2 分钟」—— 两个条件分支，屏上一个数说不清。",
  },
  {
    id: "steam-whole-vegetables",
    step: "special-cases",
    reason: "「西兰花：强火约 2 分钟；大白菜：强火约 2 分 30 秒」—— 按食材分档，取任一个都是半个意思。",
  },
];
