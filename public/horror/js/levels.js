// 10 ta daraja ("yo'l"). Har birida o'z mavzu, o'lcham, kalit soni va ruh qiyinligi bor.
// W,H — katakchalar (1 katak = 2.5 m). keys — chiqish eshigini ochish uchun kerakli kalitlar.
export const CELL = 2.5;
export const WALL_H = 3.2;

export const LEVELS = [
  { name: 'Tashlandiq uy', sub: "Eski ota-bobolar uyi. Hamma narsa shu yerdan boshlangan.", theme: 'house',
    W: 20, H: 16, maxRoom: 6, keys: 1, cabinets: 9, lampP: 0.5, throwables: 10,
    wall: 'wallpaper', floor: 'planks', tintWall: 0x8a7a68, tintFloor: 0x6a5240, fog: 0.075, ambient: 0.16,
    rooms: ['bedroom', 'kitchen', 'living', 'bath', 'library', 'nursery', 'dining'], ghost: { speed: 2.3, gap: 26, chase: 3.2 } },
  { name: "Qorong'u maktab", sub: "Dars tugagan. Lekin ba'zi o'quvchilar uyga ketmagan…", theme: 'school',
    W: 24, H: 18, maxRoom: 7, keys: 1, cabinets: 11, lampP: 0.55, throwables: 12,
    wall: 'tile', floor: 'tile', tintWall: 0x7d8a7a, tintFloor: 0x57604f, fog: 0.08, ambient: 0.15,
    rooms: ['classroom', 'classroom', 'office', 'storage', 'library', 'bath'], ghost: { speed: 2.4, gap: 24, chase: 3.3 } },
  { name: 'Kasalxona', sub: "Navbatchi shifokor hech qachon uxlamaydi.", theme: 'hospital',
    W: 26, H: 20, maxRoom: 7, keys: 2, cabinets: 13, lampP: 0.6, throwables: 12,
    wall: 'tile', floor: 'tile', tintWall: 0x9aa9a4, tintFloor: 0x6d7773, fog: 0.085, ambient: 0.14,
    rooms: ['ward', 'ward', 'surgery', 'office', 'storage', 'bath'], ghost: { speed: 2.5, gap: 22, chase: 3.4 } },
  { name: 'Eski ibodatxona', sub: "Qo'ng'iroqlar o'zi chalinadi.", theme: 'chapel',
    W: 26, H: 22, maxRoom: 8, keys: 2, cabinets: 14, lampP: 0.35, throwables: 12,
    wall: 'brick', floor: 'stone', tintWall: 0x7a6a62, tintFloor: 0x50484a, fog: 0.09, ambient: 0.12,
    rooms: ['chapel', 'ritual', 'storage', 'library', 'crypt', 'office'], ghost: { speed: 2.6, gap: 22, chase: 3.5 } },
  { name: 'Telbalar shifoxonasi', sub: "Eshiklar ichkaridan qulflangan. Ichkaridan.", theme: 'asylum',
    W: 30, H: 22, maxRoom: 7, keys: 2, cabinets: 16, lampP: 0.5, throwables: 14,
    wall: 'concrete', floor: 'tile', tintWall: 0x7d8179, tintFloor: 0x4f5350, fog: 0.095, ambient: 0.12,
    rooms: ['cell', 'cell', 'ward', 'surgery', 'office', 'storage', 'ritual'], ghost: { speed: 2.7, gap: 20, chase: 3.7 } },
  { name: 'Mehmonxona 13', sub: "13-xona. Band emas. Hech qachon band emas edi.", theme: 'hotel',
    W: 32, H: 24, maxRoom: 7, keys: 3, cabinets: 18, lampP: 0.55, throwables: 14,
    wall: 'wallpaper', floor: 'carpet', tintWall: 0x8a5a52, tintFloor: 0x5a2a2e, fog: 0.09, ambient: 0.13,
    rooms: ['bedroom', 'bedroom', 'bath', 'living', 'dining', 'storage', 'office'], ghost: { speed: 2.8, gap: 19, chase: 3.8 } },
  { name: "Yerto'la", sub: "Uyning tagida nimadir yashaydi.", theme: 'cellar',
    W: 32, H: 26, maxRoom: 8, keys: 3, cabinets: 19, lampP: 0.3, throwables: 15,
    wall: 'brick', floor: 'stone', tintWall: 0x6a5a50, tintFloor: 0x3e3a38, fog: 0.105, ambient: 0.1,
    rooms: ['storage', 'storage', 'crypt', 'ritual', 'kitchen', 'cell'], ghost: { speed: 2.9, gap: 18, chase: 3.9 } },
  { name: 'Qadimiy qasr', sub: "Egalari yuz yil oldin ketishgan. Qaytishmoqda.", theme: 'castle',
    W: 36, H: 28, maxRoom: 8, keys: 3, cabinets: 22, lampP: 0.4, throwables: 16,
    wall: 'brick', floor: 'planks', tintWall: 0x706660, tintFloor: 0x4a3a30, fog: 0.095, ambient: 0.11,
    rooms: ['dining', 'library', 'bedroom', 'chapel', 'living', 'crypt', 'ritual'], ghost: { speed: 3.0, gap: 17, chase: 4.0 } },
  { name: 'Tashlab ketilgan fabrika', sub: "Mashinalar to'xtagan. Qichqiriqlar to'xtamagan.", theme: 'factory',
    W: 38, H: 30, maxRoom: 9, keys: 4, cabinets: 24, lampP: 0.35, throwables: 16,
    wall: 'concrete', floor: 'concrete', tintWall: 0x6d6f6c, tintFloor: 0x444644, fog: 0.1, ambient: 0.1,
    rooms: ['storage', 'storage', 'office', 'surgery', 'bath', 'ritual'], ghost: { speed: 3.1, gap: 16, chase: 4.1 } },
  { name: "Do'zax uyi", sub: "Chiqish bor. Faqat u seni kutmoqda.", theme: 'hell',
    W: 42, H: 32, maxRoom: 9, keys: 4, cabinets: 28, lampP: 0.25, throwables: 18,
    wall: 'brick', floor: 'stone', tintWall: 0x7a3a34, tintFloor: 0x3a1f1f, fog: 0.115, ambient: 0.09,
    rooms: ['ritual', 'crypt', 'chapel', 'cell', 'bedroom', 'nursery', 'ward'], ghost: { speed: 3.3, gap: 14, chase: 4.4 } },
];

// qiyinchilik: ruh tezligi/faolligi
export const DIFFS = [
  { name: 'Oson', speed: 0.85, gap: 1.4, hearts: 4 },
  { name: "O'rtacha", speed: 1.0, gap: 1.0, hearts: 3 },
  { name: 'Dahshat', speed: 1.15, gap: 0.7, hearts: 2 },
];

export const LEVEL_COUNT = LEVELS.length;
