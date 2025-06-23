#!/bin/sh

if [ ! -e "config/config.yaml" ]; then
    echo "Resource not found, copying from defaults: config.yaml"
    cp -r "default/config.yaml" "config/config.yaml"
fi

# Execute postinstall to auto-populate config.yaml with missing values
npm run postinstall

# Update database host to production hostname
echo "Updating database host to postgres for production..."
sed -i 's/@[^:]*:5432/@postgres:5432/g' config/config.yaml

# Print updated database URL for confirmation
UPDATED_DB_URL=$(grep "databaseUrl" config/config.yaml)
echo "Updated database configuration: $UPDATED_DB_URL"

# Extract database host from config.yaml
DB_HOST=$(grep "databaseUrl" config/config.yaml | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=5432

echo "Checking database connection: $DB_HOST:$DB_PORT"

# Wait for database to be ready with retry limit
RETRY_COUNT=0
MAX_RETRIES=10

until nc -z "$DB_HOST" "$DB_PORT"; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for database connection... ($DB_HOST:$DB_PORT) - Attempt $RETRY_COUNT/$MAX_RETRIES"

    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Database connection failed after $MAX_RETRIES attempts. Exiting..."
        exit 1
    fi

    sleep 2
done

echo "Database connection successful! Starting application..."

# Start the server
exec node server.js --listen "$@"
