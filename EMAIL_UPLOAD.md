# Загрузка отчётов из 1С по email (через Zapier)

> **Для Mailparser** см. [MAILPARSER_UPLOAD.md](MAILPARSER_UPLOAD.md)

Схема: **1С → Gmail → Zapier → наш сайт**

---

## Шаг 1. Gmail для приёма писем

1. Создайте Gmail-адрес для отчётов, например: `analitika.otchety@gmail.com`
2. Либо используйте уже существующий

---

## Шаг 2. Настройка 1С

Настройте 1С так, чтобы письма с Excel-вложениями отправлялись на этот Gmail.

- **Кому:** `analitika.otchety@gmail.com` (ваш Gmail)
- **Тема:** любая, например «Выпуск продукции»
- **Вложение:** Excel-файл (.xlsx)
- **Как:** обычная отправка письма через SMTP/почту 1С

---

## Шаг 3. Регистрация в Zapier

1. Откройте [zapier.com](https://zapier.com) и войдите или зарегистрируйтесь
2. Бесплатного тарифа достаточно

---

## Шаг 4. Создание Zap

### 4.1. Триггер (Trigger)

1. Нажмите **Create Zap** (Создать Zap)
2. **Trigger** (Триггер):
   - Приложение: **Gmail**
   - Событие: **New Attachment** или **New Email**
3. Подключите Gmail:
   - **Connect account** → войдите в `analitika.otchety@gmail.com`
4. Если используете **New Email**:
   - Укажите нужный ящик (Inbox)
   - В фильтрах можно добавить условие: «есть вложение»
5. Нажмите **Test trigger** и проверьте, что письма видны

### 4.2. Действие (Action)

1. Нажмите **+** и выберите **Action**
2. Приложение: **Webhooks by Zapier**
3. Событие: **POST** (или **Custom Request**, если POST не даёт отправить файл)

#### Вариант A: обычный POST

- **URL:** `https://podarkioptom.onrender.com/api/upload-by-token`
- **Payload Type:** `form`
- **Data:**
  - Добавьте пару: Key = `file`, Value = выберите **Attachment** из данных Gmail (иконка с полем выбора)
- **Headers** (Add headers):
  - `X-Upload-Token` = ваш UPLOAD_TOKEN (как в Render)

#### Вариант B: Custom Request (если файл не уходит)

- **Method:** POST
- **URL:** `https://podarkioptom.onrender.com/api/upload-by-token`
- **Headers:**
  - `X-Upload-Token` = ваш UPLOAD_TOKEN
- **Body type:** form
- В форме добавьте поле с именем `file` и значением = вложение из Gmail (Attachment)

4. Нажмите **Test action** и проверьте, что запрос прошёл без ошибок

### 4.3. Сохранение Zap

1. Назовите Zap, например: «Gmail → Аналитика»
2. Включите Zap (On)

---

## Шаг 5. Проверка

1. Отправьте из 1С тестовое письмо с Excel-файлом
2. Подождите до 15 минут (на бесплатном тарифе Zapier опрашивает Gmail реже)
3. Откройте сайт и проверьте, что данные появились

---

## Важно

- **UPLOAD_TOKEN** должен быть указан в Environment на Render
- Zapier (Free) проверяет Gmail примерно раз в 15 минут
- На платном тарифе Zapier можно настроить более частую проверку

---

## Альтернатива: Mailparser

Если Zapier не подходит, можно использовать [Mailparser.io](https://mailparser.io):

1. Регистрация в Mailparser
2. Создание Inbox (уникальный email)
3. Настройка парсинга вложений
4. Webhook — URL нашего API

Mailparser чаще отправляет только распарсенные данные (JSON), а не сам файл. Для передачи именно Excel-файла удобнее Zapier.
