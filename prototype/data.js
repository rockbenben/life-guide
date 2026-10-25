window.PROTO_DATA = {
  "_note": [
    "结构化层原型数据。内容全部来自生活手册 README「每天固定做的几件事」与相关文章，未做任何发挥。",
    "图片按「步骤逐条」引用 URL，不嵌入二进制——手册文章是唯一真源，图片本体仍在 img.newzone.top。",
    "注意 tears.md 全文 7 张图里只有前 2 张属于睑缘清洗，其余是热敷/眼轮匝肌/滴眼药水。",
    "图片必须逐动作挑，不能按文章批量搬，否则会把不相干的图塞进卡片。",
    "覆盖不均是事实：动作类配图与步骤一一对应；说明类（晨光、鼻腔冲洗）根本没有图。"
  ],

  "tiers": [
    { "id": "full",    "label": "完整版",   "hint": "时间充裕，全部做" },
    { "id": "busy",    "label": "今天很忙", "hint": "只做三件：睑缘清洗、3T 保湿、睡前鼻腔冲洗。这三件加起来才真的五分钟" },
    { "id": "minimum", "label": "出差/生病", "hint": "降级方案，见《每日仪式》的「最小版本」" }
  ],

  "actions": [
    {
      "id": "morning-light",
      "title": "晨光",
      "when": "起床后",
      "window": "起床后 3 小时内",
      "dose": "至少 15 分钟",
      "intensity": "2500 Lux 以上",
      "tier": "必做",
      "inBusy": false,
      "why": "这条靠出门顺路完成，不要指望在家挤出来",
      "source": "body-care/sleep.md",
      "images": [],
      "imageNote": "原文没有配图。这类「说明类」动作靠文字就够，缺图不是缺陷。",
      "steps": [
        "起床后尽快出门，不要等到下午",
        "接触 2500 Lux 以上的光（晴天户外约 10 万 Lux，阴天户外约 1 万）",
        "连续至少 15 分钟，期间不要戴墨镜"
      ],
      "watch": "关键是强度不是时长——室内靠窗通常达不到 2500 Lux，隔着玻璃也算"
    },
    {
      "id": "eyelid-clean",
      "title": "睑缘清洗",
      "when": "早晚各一次",
      "dose": "约 10 秒 / 次，来回轻洗约 5 次",
      "tier": "必做",
      "inBusy": true,
      "busyWhy": "真正五分钟能做完的三件之一",
      "source": "body-care/tears.md",
      "images": [
        { "url": "https://img.newzone.top/20261016070430967.png?imageMogr2/format/webp",
          "alt": "做法①：用温水打湿的指尖顺着睫毛根部来回轻柔清洗" },
        { "url": "https://img.newzone.top/20261016070431680.png?imageMogr2/format/webp",
          "alt": "做法②：用温水打湿的眼周专用化妆棉顺着睫毛根部轻柔清洗" }
      ],
      "imageNote": "原文给了两种做法，这里是并列的替代方案，不是两个步骤。",
      "steps": [
        "温水打湿指尖",
        "顺着睫毛根部来回轻洗约 5 次",
        "早晚各一次，连续 2 周"
      ],
      "watch": "不要用力搓洗，也不要把手指伸进眼睑内侧"
    },
    {
      "id": "vascular-stretch",
      "title": "血管拉伸",
      "when": "早晚各一轮",
      "dose": "5 个动作 · 两足各 2 回 · 每次 30 秒 · 间隔 30 秒",
      "durationSec": 420,
      "tier": "必做",
      "inBusy": false,
      "why": "一套约 7 分钟（说明书只给了单项时长，总时长是我们自己加的）",
      "source": "body-care/vessel.md",
      "images": [
        { "url": "https://img.newzone.top/2024-10-14-09-03-58.png?imageMogr2/format/webp", "alt": "No.1 膝盖后侧：一脚向前弓步伸出，双手叠放扶在前膝，把体重压上去" },
        { "url": "https://img.newzone.top/2024-10-14-09-05-34.png?imageMogr2/format/webp", "alt": "No.2 脚根：正坐双手向后撑地，一脚向侧后方伸出，圈出脚跟处" },
        { "url": "https://img.newzone.top/2024-10-14-09-06-05.png?imageMogr2/format/webp", "alt": "No.3 大腿前侧：双腿伸直坐着，双手向后撑地，一脚向身后弯，圈出大腿" },
        { "url": "https://img.newzone.top/2024-10-14-09-06-41.png?imageMogr2/format/webp", "alt": "No.4 小腿：端坐一膝立起双手压住，重心前压，箭头示意脚跟不离地" },
        { "url": "https://img.newzone.top/2024-10-14-09-07-01.png?imageMogr2/format/webp", "alt": "No.5 臀部：仰躺双手抱住一侧膝盖拉向胸前，头贴地不起，圈出臀部" }
      ],
      "imageNote": "5 张图与 5 个动作严格一一对应，这种才叫「步骤图」。",
      "steps": [
        "No.1 膝盖后侧 —— 一脚向前弓步伸出，双手叠放扶在前膝，把体重压上去",
        "No.2 脚根 —— 正坐双手向后撑地，一脚向侧后方伸出，圈出脚跟处",
        "No.3 大腿前侧 —— 双腿伸直坐着，双手向后撑地，一脚向身后弯",
        "No.4 小腿 —— 端坐一膝立起双手压住，重心前压，脚跟不离地",
        "No.5 臀部 —— 仰躺双手抱住一侧膝盖拉向胸前，头贴地不起"
      ],
      "note": "每个动作保持 30 秒，动作之间休息约 30 秒，两足各 2 回",
      "watch": "晚上这一轮别省，睡前做效果更稳"
    },
    {
      "id": "moisturize-3t",
      "title": "3T 保湿",
      "when": "洗澡后",
      "dose": "身体部位涂 30 次 · 1 FTU",
      "tier": "必做",
      "inBusy": true,
      "busyWhy": "真正五分钟能做完的三件之一",
      "source": "body-care/skin-moisturize.md",
      "images": [
        { "url": "https://img.newzone.top/2024-10-14-09-57-13.png?imageMogr2/format/webp", "alt": "指尖单元：食指上挤出一条保湿霜，右侧示意这一条可涂满两手掌面积" },
        { "url": "https://img.newzone.top/2024-10-14-09-58-55.png?imageMogr2/format/webp", "alt": "各部位用量表：胸腹与背中各7FTU，单臂3、手1、腿6、足2" }
      ],
      "imageNote": "示意图，不是步骤图——第二张是各部位用量表，比步骤更有用。",
      "steps": [
        "取 1 FTU（够涂两个手掌面积）",
        "身体部位涂 30 次",
        "面部减量——面部娇嫩，摩擦多了反而伤"
      ],
      "watch": "面部涂太多会伤"
    },
    {
      "id": "nasal-rinse",
      "title": "睡前鼻腔冲洗",
      "when": "睡前",
      "dose": "约 2 克盐溶于 250 毫升 38℃ 温水 · 左右各 2 次",
      "tier": "必做",
      "inBusy": true,
      "busyWhy": "真正五分钟能做完的三件之一",
      "source": "body-care/sleep.md",
      "images": [],
      "imageNote": "原文没有配图。",
      "steps": [
        "约 2 克盐溶于 250 毫升 38℃ 温水",
        "左侧鼻孔冲洗 2 次",
        "换另一侧，右鼻孔冲洗 2 次"
      ],
      "watch": "水温 38℃，别用凉的"
    }
  ],

  "choices": {
    "title": "骨密度运动 · 按世代分档",
    "source": "body-care/bone.md",
    "why": "造骨细胞与破骨细胞的活动在各世代并不相同，没有一个动作适合所有人",
    "segments": [
      { "when": "成人之前",     "do": "跳跃",                        "dose": "每天 10 次 · 每周 2～3 次", "avoid": "疼痛、担心跌倒者请不要做" },
      { "when": "成人～60 代",  "do": "深蹲一类的力量训练",          "dose": "负荷越高效果越高",          "avoid": "注意脚下防跌倒；疼痛时中止" },
      { "when": "70 代～",      "do": "防跌倒——单脚站立、提踵、深蹲", "dose": "—",                       "avoid": "用一张稳固的椅子" }
    ],
    "effectNote": "骨密度的改善最低也要半年左右，刚开始时身体还看不出变化，别半途而废"
  },

  "avoidList": {
    "bone-heel-raise": {
      "title": "踮脚练习 · 哪些人不要做",
      "items": ["膝盖或腰部患有疾病的人", "正在治疗重度骨质疏松症的人", "有跌倒风险的人完全不要做"],
      "action": "以上人群应先咨询医生再练"
    }
  }
};
