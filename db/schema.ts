import { sqliteTable, text, integer, real, index, primaryKey } from "drizzle-orm/sqlite-core";
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

/** Owner-scoped listening library entries. `payload` stores a small snapshot
 * of the article/episode metadata so the library remains renderable even if
 * the source feed changes later. */
export const libraryItems = sqliteTable("library_items", {
  ownerKey: text("owner_key").notNull(),
  itemType: text("item_type").notNull(),
  itemId: text("item_id").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [
  primaryKey({ columns: [table.ownerKey, table.itemType, table.itemId] }),
  index("library_items_owner_type_updated").on(table.ownerKey, table.itemType, table.updatedAt),
]);
