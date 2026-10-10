/* Roadbook symbols. Meanings follow the event's "Symbols" sheet (FIA style); drawings are original and simple
   so they stay readable small on a phone and print cleanly. Each symbol is an SVG body on a 0..100 viewBox. */
(function (root) {
  'use strict';
  var RED = '#D0021B', BLUE = '#1565C0', ORANGE = '#F28C00', YELLOW = '#FFD400', GREEN = '#0B8A3A';
  function disc(fill, inner) { return '<circle cx="50" cy="50" r="46" fill="' + fill + '" stroke="#000" stroke-width="3"/>' + inner; }
  var W = 'fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"';
  var K = 'fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';

  var LIST = [
    // controls & zones (red = timing/controls, blue = services)
    { id: 'tc', g: 'ctrl', en: 'Time control', th: 'จุดตรวจเวลา (TC)', svg: disc(RED, '<circle cx="50" cy="50" r="26" ' + W + '/><path d="M50 32 V50 L62 58" ' + W + '/>') },
    { id: 'ssStart', g: 'ctrl', en: 'SS start', th: 'จุดเริ่ม SS', svg: disc(RED, '<path d="M36 76 V24" ' + W + '/><path d="M38 26 H70 L62 37 L70 48 H38 Z" fill="#000" stroke="#fff" stroke-width="3"/>') },
    { id: 'ssFinish', g: 'ctrl', en: 'SS finish', th: 'เส้นชัย SS', svg: disc(RED, '<rect x="26" y="26" width="48" height="48" fill="#fff"/><g fill="#000"><rect x="26" y="26" width="12" height="12"/><rect x="50" y="26" width="12" height="12"/><rect x="38" y="38" width="12" height="12"/><rect x="62" y="38" width="12" height="12"/><rect x="26" y="50" width="12" height="12"/><rect x="50" y="50" width="12" height="12"/><rect x="38" y="62" width="12" height="12"/><rect x="62" y="62" width="12" height="12"/></g>') },
    { id: 'stop', g: 'ctrl', en: 'Stop control', th: 'จุด STOP', svg: '<path d="M30 4 H70 L96 30 V70 L70 96 H30 L4 70 V30 Z" fill="' + RED + '" stroke="#000" stroke-width="3"/><text x="50" y="61" font-family="Arial,sans-serif" font-weight="700" font-size="30" text-anchor="middle" fill="#fff">STOP</text>' },
    { id: 'endZone', g: 'ctrl', en: 'End of area', th: 'สิ้นสุดพื้นที่', svg: disc(ORANGE, '<path d="M20 64 L64 20 M30 78 L78 30 M44 86 L86 44" stroke="#000" stroke-width="7"/>') },
    { id: 'refuel', g: 'ctrl', en: 'Refuelling zone', th: 'จุดเติมน้ำมัน', svg: disc(BLUE, '<rect x="30" y="28" width="26" height="46" rx="3" fill="#fff"/><rect x="35" y="33" width="16" height="12" fill="' + BLUE + '"/><path d="M56 40 H64 V64 a4 4 0 0 0 8 0 V40 L64 30" ' + W + ' stroke-width="5"/>') },
    { id: 'tyre', g: 'ctrl', en: 'Tyre marking zone', th: 'จุดตรวจยาง', svg: disc(BLUE, '<circle cx="50" cy="50" r="26" ' + W + ' stroke-width="9"/><circle cx="50" cy="50" r="9" fill="#fff"/>') },
    { id: 'service', g: 'ctrl', en: 'Service zone', th: 'จุดเซอร์วิส', svg: disc(BLUE, '<path d="M32 70 L58 44" ' + W + ' stroke-width="9"/><path d="M58 30 a14 14 0 1 0 14 14 l-10 2 -6 -6 z" fill="#fff"/>') },
    { id: 'media', g: 'ctrl', en: 'Media zone', th: 'จุดสื่อมวลชน', svg: disc(BLUE, '<rect x="42" y="22" width="16" height="32" rx="8" fill="#fff"/><path d="M34 46 a16 16 0 0 0 32 0 M50 62 V76 M40 76 H60" ' + W + ' stroke-width="5"/>') },
    { id: 'radio', g: 'ctrl', en: 'Radio point', th: 'จุดวิทยุ (RP)', svg: disc(BLUE, '<path d="M60 20 L38 52 H56 L42 80" ' + W + '/>') },
    { id: 'medical', g: 'ctrl', en: 'Medical vehicle', th: 'จุดรถพยาบาล', svg: disc(BLUE, '<path d="M50 26 V74 M26 50 H74" stroke="#fff" stroke-width="16"/>') },
    // roads & signs
    { id: 'light', g: 'road', en: 'Traffic light', th: 'ไฟจราจร', svg: '<rect x="32" y="4" width="36" height="92" rx="8" fill="#222" stroke="#000" stroke-width="3"/><circle cx="50" cy="22" r="11" fill="' + RED + '"/><circle cx="50" cy="50" r="11" fill="' + YELLOW + '"/><circle cx="50" cy="78" r="11" fill="' + GREEN + '"/>' },
    { id: 'highway', g: 'road', en: 'Highway', th: 'ทางหลวง', svg: '<rect x="8" y="8" width="84" height="84" rx="8" fill="' + GREEN + '" stroke="#000" stroke-width="3"/><path d="M40 84 L46 22 M60 84 L54 22" stroke="#fff" stroke-width="7"/><path d="M50 30 V40 M50 52 V62 M50 74 V82" stroke="#fff" stroke-width="4"/>' },
    { id: 'town', g: 'road', en: 'Town / village entrance', th: 'เข้าเขตชุมชน', svg: '<rect x="4" y="26" width="92" height="48" rx="5" fill="' + YELLOW + '" stroke="#000" stroke-width="4"/><path d="M22 60 V44 L32 36 L42 44 V60 Z M56 60 V40 L68 32 L80 40 V60 Z" fill="#000"/>' },
    { id: 'evac', g: 'road', en: 'Evacuation road', th: 'ทางหนีภัย', svg: '<path d="M6 50 L36 22 V36 H92 V64 H36 V78 Z" fill="' + YELLOW + '" stroke="#000" stroke-width="4" stroke-linejoin="round"/>' },
    { id: 'bump', g: 'road', en: 'Speed bump', th: 'ลูกระนาด', svg: '<path d="M50 6 L94 84 H6 Z" fill="#fff" stroke="' + RED + '" stroke-width="7" stroke-linejoin="round"/><path d="M24 72 Q50 44 76 72" fill="#000"/><path d="M18 74 H82" stroke="#000" stroke-width="4"/>' },
    { id: 'toll', g: 'road', en: 'Pay toll', th: 'ด่านเก็บเงิน', svg: '<path d="M8 56 H92" stroke="#000" stroke-width="7"/><path d="M14 56 V36 H30 V56 M42 56 V36 H58 V56 M70 56 V36 H86 V56" ' + K + ' stroke-width="4"/><path d="M50 92 V18 M40 28 L50 16 L60 28" ' + K + '/>' },
    // landmarks
    { id: 'house', g: 'mark', en: 'House', th: 'บ้าน', svg: '<rect x="12" y="20" width="76" height="60" fill="#fff" stroke="#000" stroke-width="5"/><path d="M12 20 L88 80 M88 20 L12 80" stroke="#000" stroke-width="4"/>' },
    { id: 'temple', g: 'mark', en: 'Temple / church', th: 'วัด / โบสถ์', svg: '<path d="M50 6 L58 26 H42 Z" fill="#000"/><path d="M14 52 L50 24 L86 52 Z" fill="#fff" stroke="#000" stroke-width="5" stroke-linejoin="round"/><path d="M22 50 V90 H78 V50" fill="#fff" stroke="#000" stroke-width="5"/><path d="M42 90 V68 H58 V90" fill="none" stroke="#000" stroke-width="5"/>' },
    { id: 'tree', g: 'mark', en: 'Tree', th: 'ต้นไม้', svg: '<path d="M46 66 H54 V94 H46 Z" fill="#000"/><circle cx="50" cy="38" r="30" fill="#2E7D32" stroke="#000" stroke-width="4"/>' },
    { id: 'bridge', g: 'mark', en: 'Bridge', th: 'สะพาน', svg: '<path d="M30 12 H40 V88 H30 M70 12 H60 V88 H70" ' + K + ' stroke-width="8"/>' },
    { id: 'fence', g: 'mark', en: 'Fence', th: 'รั้ว', svg: '<path d="M50 8 V92" stroke="#000" stroke-width="3"/><path d="M42 14 L58 22 M42 30 L58 38 M42 46 L58 54 M42 62 L58 70 M42 78 L58 86" stroke="#000" stroke-width="4"/>' },
    { id: 'care', g: 'mark', en: 'Take care', th: 'ระวัง', svg: '<rect x="40" y="8" width="20" height="58" rx="8" fill="#000"/><circle cx="50" cy="84" r="11" fill="#000"/>' },
    { id: 'rail', g: 'mark', en: 'Rail track', th: 'ทางรถไฟ', svg: '<path d="M4 38 H96 M4 62 H96" stroke="#000" stroke-width="5"/><path d="M14 28 V72 M30 28 V72 M46 28 V72 M62 28 V72 M78 28 V72 M94 28 V72" stroke="#000" stroke-width="4"/>' },
    { id: 'tires', g: 'mark', en: 'Tyre barrier', th: 'กองยาง', svg: '<rect x="26" y="14" width="48" height="20" rx="9" fill="#222" stroke="' + YELLOW + '" stroke-width="5"/><rect x="26" y="40" width="48" height="20" rx="9" fill="#222" stroke="' + YELLOW + '" stroke-width="5"/><rect x="26" y="66" width="48" height="20" rx="9" fill="#222" stroke="' + YELLOW + '" stroke-width="5"/>' },
    { id: 'hay', g: 'mark', en: 'Hay bale', th: 'ฟาง', svg: '<ellipse cx="50" cy="28" rx="34" ry="12" fill="' + YELLOW + '" stroke="#000" stroke-width="4"/><path d="M16 28 V72 a34 12 0 0 0 68 0 V28" fill="' + YELLOW + '" stroke="#000" stroke-width="4"/><ellipse cx="50" cy="28" rx="34" ry="12" fill="#FFE766" stroke="#000" stroke-width="4"/>' },
    { id: 'cut', g: 'mark', en: 'Cut protection', th: 'กันตัดโค้ง', svg: '<path d="M30 8 V92" stroke="' + RED + '" stroke-width="7"/><path d="M30 56 H74 V92 H30 Z" fill="#fff" stroke="' + RED + '" stroke-width="5"/><path d="M30 92 L74 56 V92 Z" fill="' + RED + '"/>' },
    { id: 'phone', g: 'mark', en: 'Phone signal', th: 'มีสัญญาณโทรศัพท์', svg: '<rect x="26" y="6" width="48" height="88" rx="9" fill="#fff" stroke="#000" stroke-width="5"/><text x="50" y="58" font-family="Arial,sans-serif" font-weight="700" font-size="22" text-anchor="middle" fill="#000">YES</text>' }
  ];
  var BY = {}; LIST.forEach(function (s) { BY[s.id] = s; });
  function svg(id, size) {
    var s = BY[id]; if (!s) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="' + (size || 32) + '" height="' + (size || 32) + '" aria-hidden="true">' + s.svg + '</svg>';
  }
  root.RBS = { LIST: LIST, BY: BY, svg: svg };
})(this);
