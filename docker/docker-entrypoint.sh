#!/bin/sh

if [ ! -e "config/config.yaml" ]; then
    echo "Resource not found, copying from defaults: config.yaml"
    cp -r "default/config.yaml" "config/config.yaml"
fi

# Execute postinstall to auto-populate config.yaml with missing values
npm run postinstall

# Extract database host from config.yaml
DB_HOST=$(grep "databaseUrl" config/config.yaml | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=5432


echo "Checking database connection: $DB_HOST:$DB_PORT"

# Wait for database to be ready
until nc -z "$DB_HOST" "$DB_PORT"; do
    echo "Waiting for database connection... ($DB_HOST:$DB_PORT)"
    sleep 2
done

echo "Database connection successful! Starting application..."

# Start the server
exec node server.js --listen "$@"
