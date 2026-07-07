#!/bin/bash
set -e

# Sync mobile app version setting from app.json on the host to the database
if [ ! -f packages/mobile/app.json ]; then
    echo "packages/mobile/app.json not found on host. Skipping sync."
    exit 0
fi

VERSION=$(node -p "require('./packages/mobile/app.json').expo.version" 2>/dev/null || echo "")
if [ -z "$VERSION" ]; then
    echo "Could not extract version from packages/mobile/app.json. Skipping sync."
    exit 0
fi

if [ "$1" == "--prod" ]; then
    sudo docker compose -f docker-compose.prod.yml exec -T backend node -e "const db = require('./db'); db.query(\"UPDATE settings SET setting_value = '$VERSION' WHERE setting_key = 'mobile_app_version'\").then(() => console.log('Successfully synced mobile version to database (production).'))"
else
    docker compose exec -T backend node -e "const db = require('./db'); db.query(\"UPDATE settings SET setting_value = '$VERSION' WHERE setting_key = 'mobile_app_version'\").then(() => console.log('Successfully synced mobile version to database (development).'))"
fi
