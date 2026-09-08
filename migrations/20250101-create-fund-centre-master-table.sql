-- Create fund_centre_master table with all latest columns
CREATE TABLE IF NOT EXISTS `fund_centre_master` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `city` VARCHAR(100) NULL,
  `fund_centre_code` VARCHAR(50) NOT NULL,
  `country` VARCHAR(100) NOT NULL,
  `latitude` DECIMAL(10, 8) NULL,
  `longitude` DECIMAL(11, 8) NULL,
  `gmt_timezone` VARCHAR(50) NOT NULL,
  `iana_timezone` VARCHAR(100) NULL,
  `dst_observed` ENUM('Y', 'N') DEFAULT 'N',
  `currency` VARCHAR(10) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_fund_centre_code` (`fund_centre_code`),
  KEY `idx_fund_centre_code` (`fund_centre_code`),
  KEY `idx_country` (`country`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
