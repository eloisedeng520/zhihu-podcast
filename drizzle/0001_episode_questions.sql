CREATE TABLE `episode_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`position_seconds` real NOT NULL,
	`question_text` text NOT NULL,
	`answer_text` text,
	`source_ids` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
CREATE INDEX `episode_questions_owner_episode_created` ON `episode_questions` (`owner_key`,`episode_id`,`created_at`);
CREATE INDEX `episode_questions_owner_status` ON `episode_questions` (`owner_key`,`status`);
