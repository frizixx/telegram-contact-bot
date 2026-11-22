# 🚀 Деплой бота на Koyeb (бесплатно, 24/7, без карты)

## ✅ Что уже готово:
- ✅ Код залит на GitHub: https://github.com/frizixx/telegram-contact-bot
- ✅ Dockerfile настроен
- ✅ .gitignore защищает токены
- ✅ Все зависимости в package.json

## 📋 Пошаговая инструкция:

### Шаг 1: Регистрация на Koyeb
1. Открой: **https://app.koyeb.com/auth/signup**
2. Нажми **"Sign up with GitHub"**
3. Авторизуй Koyeb (frizixx аккаунт)

### Шаг 2: Создание приложения
1. После входа нажми **"Create App"**
2. Выбери **"Deploy from GitHub"**
3. Найди и выбери репозиторий: **frizixx/telegram-contact-bot**
4. Branch: **main**

### Шаг 3: Настройка окружения
В разделе **"Environment variables"** добавь:

```
BOT_TOKEN=9199849245:AAGiYV8eYvgquBgmdBeoTpXKwnw5YoIaR6o
OWNER_ID=5226782090
```

### Шаг 4: Настройки сборки
- **Builder:** Dockerfile ✅ (уже выбран автоматически)
- **Port:** 8080 (или оставь пустым, бот не использует HTTP)

### Шаг 5: Настройки инстанса
- **Instance type:** Nano (Free) ✅
- **Regions:** Frankfurt (europe-west)
- **Scaling:** 1 instance (минимум и максимум)

### Шаг 6: Деплой
1. **App name:** `telegram-contact-bot` (или любое имя)
2. Нажми **"Deploy"**

## ⏱️ Время деплоя: 2-3 минуты

После деплоя бот автоматически запустится и будет работать **24/7**.

## 🔍 Проверка работы:
1. Открой Telegram
2. Найди бота: **@FrizixConnectingBot**
3. Отправь `/start`
4. Должно прийти приветствие с GIF

## 📊 Мониторинг:
- Логи: https://app.koyeb.com → твоё приложение → "Logs"
- Статус: должен быть зелёный "Healthy"

## 🆓 Free tier лимиты Koyeb:
- ✅ 512 MB RAM
- ✅ 2 GB Disk
- ✅ 100 GB Transfer/месяц
- ✅ **Always-on** (не засыпает!)
- ✅ Без карты

## ❓ Если что-то пошло не так:
1. Проверь логи в Koyeb dashboard
2. Убедись что BOT_TOKEN правильный (начинается с `7`)
3. Проверь что репозиторий public или Koyeb имеет доступ

---

**Репозиторий:** https://github.com/frizixx/telegram-contact-bot
**Создан:** 2026-11-22 18:58 UTC
