DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morph_gateway_reader') THEN
    CREATE ROLE morph_gateway_reader LOGIN PASSWORD 'morph_gateway_dev';
  END IF;
END
$$;

ALTER ROLE morph_gateway_reader SET default_transaction_read_only = on;
ALTER ROLE morph_gateway_reader SET statement_timeout = '5s';
GRANT CONNECT ON DATABASE morphui TO morph_gateway_reader;
GRANT USAGE ON SCHEMA public TO morph_gateway_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO morph_gateway_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE morphui IN SCHEMA public
  GRANT SELECT ON TABLES TO morph_gateway_reader;
