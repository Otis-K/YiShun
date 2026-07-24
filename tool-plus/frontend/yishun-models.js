(function exposeYishunModels() {
  'use strict';

  const models = [
    { id: 'YS-001', name: '林栀', gender: 'female', style: 'editorial', tag: '高级时装', meta: '冷感 · 棚拍 · 女装', region: '亚洲', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-01.jpg' },
    { id: 'YS-002', name: '乔安', gender: 'female', style: 'casual', tag: '清新日常', meta: '自然 · 通勤 · 女装', region: '亚洲', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-02.jpg' },
    { id: 'YS-003', name: '西西', gender: 'female', style: 'editorial', tag: '东方气质', meta: '克制 · 极简 · 女装', region: '亚洲', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-03.jpg' },
    { id: 'YS-004', name: 'Mia', gender: 'female', style: 'casual', tag: '街头潮流', meta: '活力 · 青春 · 女装', region: '欧美', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-04.jpg' },
    { id: 'YS-005', name: '陆屿', gender: 'male', style: 'editorial', tag: '都市型男', meta: '利落 · 商务 · 男装', region: '亚洲', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-05.jpg' },
    { id: 'YS-006', name: '周野', gender: 'male', style: 'casual', tag: '松弛日常', meta: '自然 · 休闲 · 男装', region: '亚洲', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-06.jpg' },
    { id: 'YS-007', name: 'Nina', gender: 'female', style: 'casual', tag: '甜酷风格', meta: '明快 · 少女 · 女装', region: '欧美', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-07.jpg' },
    { id: 'YS-008', name: '陈默', gender: 'male', style: 'editorial', tag: '质感大片', meta: '沉稳 · 极简 · 男装', region: '亚洲', ageGroup: '青年', source: 'official', image: 'assets/yishun/model-08.jpg' },
  ];

  window.YISHUN_MODELS = Object.freeze(models.map(model => Object.freeze({ ...model })));
})();
