ALTER TABLE `episodes` ADD `owner_key` text NOT NULL DEFAULT '';
CREATE INDEX `episodes_owner_created` ON `episodes` (`owner_key`,`created_at`);
