#!/bin/bash

# Создание .replit конфигурации
cat > .replit << 'REPLIT'
run = "node bot.js"
language = "nodejs"

[nix]
channel = "stable-22_11"

[deployment]
run = ["node", "bot.js"]
deploymentTarget = "cloudrun"
REPLIT

# Создание replit.nix для зависимостей
cat > replit.nix << 'NIX'
{ pkgs }: {
  deps = [
    pkgs.nodejs-18_x
  ];
}
NIX

echo "✅ Файлы конфигурации Replit созданы"
echo ""
echo "📋 Следующие шаги:"
echo "1. Открой https://replit.com/new/github"
echo "2. Импортируй этот репозиторий"
echo "3. Добавь Secrets:"
echo "   BOT_TOKEN=$(grep BOT_TOKEN .env | cut -d= -f2)"
echo "   OWNER_ID=$(grep OWNER_ID .env | cut -d= -f2)"
echo "4. Нажми Run"
echo "5. Включи 'Always On' (бесплатно 750 часов/месяц)"
