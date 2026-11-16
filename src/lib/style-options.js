// Answer options shared by the first-launch quiz and «Профиль → Мой стиль».
// Profile fields stay plain comma-separated text, so the stylist prompt reads them as before.
export const STYLES = ["Casual", "Street", "Классика", "Минимализм", "Smart casual", "Спорт", "Old money", "Бохо", "Гранж", "Y2K"];
export const FITS = ["Оверсайз", "Прямой", "Приталенный", "Свободный низ", "Укороченный верх"];
export const GOALS = ["Подчеркнуть фигуру", "Выглядеть выше", "Комфорт", "Выглядеть дороже", "Быть заметнее", "Не выделяться"];
export const PLACES = ["Учёба", "Работа", "Спорт", "Вечеринки", "Свидания", "Дом"];
export const AVOID = ["Узкие джинсы", "Яркие цвета", "Крупные принты", "Шорты", "Каблуки", "Галстуки", "Обтягивающее"];
export const GENDERS = [["male", "Мужчина"], ["female", "Женщина"], ["", "Не указывать"]];
export const genderLabel = (id) => (GENDERS.find(([g]) => g === id) || GENDERS[2])[1];

export const splitList = (text) => String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
export const joinList = (values) => [...new Set([...values].map((s) => String(s).trim()).filter(Boolean))].join(", ");
