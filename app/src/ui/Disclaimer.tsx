/**
 * 保健内容的统一免责声明。
 *
 * 不逐卡重复（每张卡都挂一句会把卡片撑成模板），放在「今天」页脚与「设置 → 关于」。
 * 疾病类文章页另有更具体的「不是治疗方案」提示。
 */
export const DISCLAIMER_TEXT =
  "这里的动作来自《生活手册》，是生活参考，不替代医生诊断；有疾病、正在治疗或出现不适，先咨询医生。";

export function Disclaimer() {
  return <p class="lg-disclaim">{DISCLAIMER_TEXT}</p>;
}
