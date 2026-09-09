import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  lockToken: text("lock_token"),
  lockUntil: integer("lock_until").notNull().default(0),
});
export const episodeQuestions = sqliteTable("episode_questions", {
  id:text("id").primaryKey(), episodeId:text("episode_id").notNull(), ownerKey:text("owner_key").notNull(),
  positionSeconds:real("position_seconds").notNull(), questionText:text("question_text").notNull(), answerText:text("answer_text"),
  sourceIds:text("source_ids").notNull(), status:text("status").notNull(), errorCode:text("error_code"), createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(),
},table=>[index("episode_questions_owner_episode_created").on(table.ownerKey,table.episodeId,table.createdAt),index("episode_questions_owner_status").on(table.ownerKey,table.status)]);
