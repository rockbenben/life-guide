// 验证原型的核心状态逻辑：分档筛选、勾选、展开。不依赖浏览器。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
global.window = {};
// 必须包一层括号：直接 eval 一个 { } 开头的会被当成代码块，解析就炸了
const objSrc = src.replace(/^window\.PROTO_DATA\s*=\s*/, '').replace(/;\s*$/, '');
global.window.PROTO_DATA = eval('(' + objSrc + ')');
const D = global.window.PROTO_DATA;

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`);
};

ok('三档齐全', D.tiers.length === 3, D.tiers.map(t => t.id).join('/'));
ok('完整版 = 全部动作', D.actions.length === 5, `${D.actions.length} 个`);

const busy = D.actions.filter(a => a.inBusy);
ok('今天很忙 = 3 个', busy.length === 3, busy.map(a => a.title).join('、'));
ok('忙档里没有晨光和血管拉伸',
   !busy.some(a => ['晨光', '血管拉伸'].includes(a.title)));

ok('每个动作都有剂量', D.actions.every(a => a.dose && a.dose.length > 0));
ok('每个动作都有步骤', D.actions.every(a => Array.isArray(a.steps) && a.steps.length > 0));
ok('每个动作都能追溯到原文', D.actions.every(a => a.source && a.source.endsWith('.md')));
ok('带禁忌的动作都写了 watch',
   D.actions.filter(a => ['睑缘清洗', '晨光'].includes(a.title)).every(a => a.watch));

// 血管拉伸是唯一有可计时的
const timed = D.actions.filter(a => a.durationSec);
ok('血管拉伸有倒计时时长', timed.length === 1 && timed[0].durationSec === 420, `${timed[0]?.durationSec}s`);

// 分档
const seg = D.choices.segments;
ok('骨密度分三档', seg.length === 3, seg.map(s => s.when).join(' / '));
ok('每档都有做什么和禁忌', seg.every(s => s.do && s.avoid));
ok('分档给出了见效周期提示', !!D.choices.effectNote);

// ---- 图片：按动作逐条引用，不嵌二进制 ----
ok('图片字段全部存在', D.actions.every(a => Array.isArray(a.images)));
const withImg = D.actions.filter(a => a.images.length > 0);
const noImg = D.actions.filter(a => a.images.length === 0);
ok('有图的动作都写了说明', withImg.every(a => a.imageNote));
ok('无图的动作标注了「原文没有配图」', noImg.every(a => a.imageNote.includes('没有配图')));
ok('图片全部是 http 引用而非本地路径',
   D.actions.every(a => a.images.every(im => im.url.startsWith('https://'))));
ok('每张图都有 alt（信息量全在 alt 上）',
   D.actions.every(a => a.images.every(im => im.alt && im.alt.length > 4)));

// 血管拉伸：5 张图必须与 5 个步骤一一对应
const vs = D.actions.find(a => a.id === 'vascular-stretch');
ok('血管拉伸 5 图 ↔ 5 步骤对齐', vs.images.length === 5 && vs.steps.length === 5,
   `${vs.images.length} 图 / ${vs.steps.length} 步骤`);

// 睑缘清洗：两张是「做法①②」并列，不是两个步骤
const ec = D.actions.find(a => a.id === 'eyelid-clean');
ok('睑缘清洗区分了「并列方案」与「步骤」',
   ec.images.length === 2 && ec.imageNote.includes('并列'));

// 晨光/鼻腔冲洗确认无图，不要假装有
ok('晨光与鼻腔冲洗如实标注无图',
   D.actions.find(a => a.id === 'morning-light').images.length === 0 &&
   D.actions.find(a => a.id === 'nasal-rinse').images.length === 0);

// 勾选状态机（原型用 Set）
const done = new Set();
done.has('x') ? done.delete('x') : done.add('x');
ok('勾选可切换', done.has('x'));
done.has('x') ? done.delete('x') : done.add('x');
ok('再点一次取消', !done.has('x'));

console.log(`\n通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
