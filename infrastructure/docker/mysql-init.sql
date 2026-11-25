-- Local only: a separate database for integration tests, owned by the app user.
CREATE DATABASE IF NOT EXISTS hrms_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON hrms_test.* TO 'hrms'@'%';
-- Prisma migrate dev needs a shadow database.
GRANT CREATE, DROP ON *.* TO 'hrms'@'%';
FLUSH PRIVILEGES;
