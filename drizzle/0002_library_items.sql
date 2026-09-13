CREATE TABLE `library_items` (
	`owner_key` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`payload` text NOT NULL DEFAULT '{}',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `item_type`, `item_id`)
);
CREATE INDEX `library_items_owner_type_updated` ON `library_items` (`owner_key`,`item_type`,`updated_at`);
