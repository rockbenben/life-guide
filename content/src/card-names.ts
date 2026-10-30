/**
 * 缺名卡的动作名（2026-10-31 补）。
 *
 * **为什么补**：2026-10-24 那轮改名给 239 张卡重起了动作名，但漏了 78 张。
 * 漏掉的这些在屏上靠「原文小节名」回落显示（`lines.ts` 的 cardName）——
 * 能看，但小节名是**文章的骨架**不是**这张卡在做什么**：
 * 「每天 50 次快速踮脚尖」还行，「它的视力拿走的是视野」就不像动作名，
 * 而「检查、治疗与就诊」这种更是同一篇里有好几张同名。
 *
 * **起名的规矩**（照 2026-10-24 那轮定的）：
 *   · 说清**这张卡在做什么**（不是「这一节讲什么」）
 *   · 长度 ≤ 16 字（`NAME_MAX`，超了收起态一行放不下）
 *   · 同一篇里不许撞名 —— 撞了屏上并排两行一样，读的人以为出了错
 *   · 名字里带**该带的数字**（「每天 50 次」「冷藏一夜」）——
 *     那是用户点进去之前就想知道的事
 *
 * 这些卡大多已签字（reviewed）—— 改 `name` 会让 R12 的指纹失效，要重签。
 */
export const CARD_NAMES: Record<string, string> = {
  // ── body-care ──
  "post-bath-rinse-rise": "泡完冲冷水再起身",
  "heel-raise": "每天踮脚 50 次",
  "wide-step-walking": "大步幅走，步幅 65 厘米",
  "three-minute-foot-self-check": "三分钟自查脚的缺血警讯",
  "compression-stockings-use": "弹力袜的四步穿法",
  "measure-eye-burden-by-use": "测一次睫状肌负担度",
  "clean-lenses-with-water": "镜片先冲水再擦",
  "glaucoma-visual-field-loss": "青光眼拿走的是视野",
  "glaucoma-blind-spot-experience": "亲手找出自己的盲点",
  "glaucoma-diagnosis-treatment": "青光眼要查哪几项",
  "refrigerate-for-one-point": "冷藏一夜，纤维多 1 分",
  "straighten-curly-hair": "卷发内回转 180 度拉直",
  "three-step-preparation": "做动作前的三步准备",
  "jaw-muscle-massage": "咬肌按摩 10 秒",
  "kidney-hydration-on-thirst": "口渴就补水，别等",
  "kidney-egfr-early-table": "查 eGFR 看肾功能",
  "kidney-cardio-cognition-risk": "肾功能降了会连累心血管",
  "kidney-dehydration-hypoxia": "脱水就是肾脏缺氧",
  "knee-ankle-cross": "足踝交叉 6 秒防膝盖痛",
  "alt-cause-differential": "ALT 超 30 的多种原因",
  "fatty-liver-weight-plan": "减重 3% 就能改善脂肪肝",
  "alt-care-pathway": "ALT 升高该去哪看",
  "mci-four-combination": "改善认知的四件事一起做",
  "daily-supportive-call": "每天给家人打 1 通电话",
  "avoid-self-continuing-meds": "症状不好别自己续药",
  "read-package-insert": "吃市售药前先读说明书",
  "pancreatic-cancer-visit-path": "看胰腺癌该怎么说怎么查",
  "bee-breathing": "蜂鸣式呼吸法，先 5 次起步",
  "low-dose-contraceptive-overview": "低剂量避孕药的利与弊",
  "hormonal-fluctuation-mechanism": "两种激素一个月涨落一次",
  "bloating-management": "胃胀的三条对策",
  "heartburn-prevention": "防止胃灼热",
  "urgent-care-signals": "胃痛出现这些信号要去医院",
  "stomach-pain-management": "胃痛的对策",
  "functional-dyspepsia-check": "对照症状自查消化不良",
  "voice-practice-limits": "练声要守住说明书给的量",
  "adult-food-allergy-pattern": "大人的过敏一半是果蔬",

  // ── food ──
  "calculate-pure-alcohol-intake": "用纯酒精量算饮酒账",
  "make-wet-meat-sauce": "盐苹果拌绞肉做肉酱",
  "make-tender-chicken-breast": "盐苹果揉鸡胸肉不柴",
  "avocado-brown-smoothie": "变色的牛油果打成果昔",
  "burdock-rinse-direct-use": "牛蒡冲掉泥就能用",
  "high-heat-short-cooking": "卷心菜高温短时压臭味",
  "dilute-canned-stock": "罐头汁稀释后当高汤",
  "fruit-syrup-yogurt": "水果罐头糖浆拌酸奶",
  "milk-soak-chicken": "牛奶抓揉鸡胸肉 1 分钟",
  "cholesterol-intake-guideline-update": "胆固醇上限已撤回",
  "egg-cholesterol-boundary": "胆固醇偏高每天少于 200mg",
  "blood-lipid-reference-values": "血脂的三个参考值",
  "champion-home-brew": "冠军冲法：1:15 分 4 次",
  "raw-coffee-cream": "整颗咖啡豆冷藏生奶油",
  "microwave-sweet-root-ham-egg": "微波甘根火腿蛋",
  "creamy-scrambled-eggs": "弱火慢搅的滑嫩炒蛋",
  "three-step-freezing-prep": "冷冻前的三步处理",
  "overnight-dry-ingredients": "食材过夜风干再下锅",
  "garlic-water-by-use": "蒜水按用途调两种浓度",
  "gyoza-steam-then-fry": "饺子先蒸后煎出焦壳",
  "gyoza-few-pleats": "少褶包法锁住肉汁",
  "kimchi-container-acidity-check": "看容器预判泡菜酸度",
  "soy-butter-maple-syrup": "黄油枫糖浆打糖浆",
  "minced-meat-stock": "绞肉 10 分钟出高汤",
  "okara-moisture-lock": "豆渣吸水后拌油锁水",
  "omega-3-food-pairings": "每天 1 茶匙欧米伽 3 怎么放",
  "make-resistant-starch-potato": "土豆冷藏一晚生抗性淀粉",
  "make-okuda-tomato-sauce": "奥田式番茄酱：油番茄配平",
  "keep-bitterness-slow-heat": "故意留苦：慢慢加温",

  // ── life-hacks ──
  "ultra-slow-blink-four-steps": "超慢眨眼四步，一次 3 秒",
  "coagulant-portable-toilet": "便携厕所三步用",
  "disaster-message-listen": "拨 171 按 2 收听留言",
  "altruistic-disaster-preparedness": "把应急食品当礼物送出去",
  "avoid-retaining-restricting-intake": "断水时别硬憋也别少吃",
  "ac-professional-internal-cleaning": "空调内部要请专业业者洗",
  "washer-drum-mold-cleaning": "洗衣槽用含氯剂清洁",
  "mold-alcohol-removal": "除霉：酒精喷后压 1 分钟",
  "mold-furniture-gap": "家具留 4 厘米缝防复发",
  "measure-personal-pillow-height": "在家量出适合自己的枕头高度",

  // ── mind-growth ──
  "one-minute-mindful-activity": "一分钟也能冥想",
  "coexist-with-brain-habit": "脑习惯不会消失，学会相处",
};
