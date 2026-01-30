# Развёртывание аналитики в интернете

## Способ 1: Docker (рекомендуется)

Подходит для любого VPS (DigitalOcean, Timeweb, Hetzner, Selectel и т.д.).

### На сервере

1. Установите Docker и Docker Compose:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

2. Скопируйте проект на сервер (через git или scp):
   ```bash
   scp -r ProAnalitik user@your-server:/home/user/
   ```

3. Положите Excel-файлы в папку `data/` или в корень проекта.

4. Запустите:
   ```bash
   cd ProAnalitik
   docker compose up -d --build
   ```

5. Откройте в браузере: `http://IP-СЕРВЕРА:8000`

### Обновление данных

Добавьте новые Excel в `data/` на сервере и нажмите ⟳ в интерфейсе — данные обновятся.

---

## Способ 2: Без Docker (systemd на Linux)

1. Установите Python 3.11+, Node.js
2. На сервере:
   ```bash
   cd ProAnalitik
   python3 -m venv venv
   source venv/bin/activate
   pip install -r backend/requirements.txt
   cd frontend && npm install && npm run build && cd ..
   ```
3. Запуск через systemd — создайте `/etc/systemd/system/proanalitik.service`:
   ```ini
   [Unit]
   Description=ProAnalitik
   After=network.target

   [Service]
   User=www-data
   WorkingDirectory=/path/to/ProAnalitik
   ExecStart=/path/to/ProAnalitik/venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8000
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
4. `sudo systemctl enable proanalitik && sudo systemctl start proanalitik`
5. Настройте Nginx как reverse proxy (см. ниже)

---

## Nginx (reverse proxy + HTTPS)

Для доступа по домену и HTTPS:

```nginx
server {
    listen 80;
    server_name analytics.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS через Let's Encrypt:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d analytics.yourdomain.com
```

---

## Публичные облака (без своего сервера)

| Сервис | Сложность | Бесплатный тариф |
|--------|-----------|------------------|
| **Railway** | Низкая | Ограниченные часы |
| **Render** | Низкая | Sleep после неактивности |
| **Fly.io** | Средняя | Есть |
| **PythonAnywhere** | Низкая | Ограничения |

Для Railway/Render: загрузите проект в GitHub, подключите репозиторий к сервису, укажите команду запуска и переменные. Для хранения Excel понадобится volume или внешнее хранилище (S3 и т.п.).
