use crate::db::{WidgetDb, WidgetError, WidgetResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub created_at: i64,
    pub done_at: Option<i64>,
    pub position: i64,
}

const MAX_TITLE: usize = 500;

fn clean_title(title: &str) -> WidgetResult<String> {
    let t = title.trim();
    if t.is_empty() {
        return Err(WidgetError::Invalid("Task can't be empty".into()));
    }
    Ok(t.chars().take(MAX_TITLE).collect())
}

impl WidgetDb {
    /// Open tasks first (in manual order), then completed ones (latest first).
    pub fn todos(&self) -> WidgetResult<Vec<Todo>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, done, created_at, done_at, position FROM todos
             ORDER BY done ASC, CASE WHEN done = 0 THEN position END ASC, done_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Todo {
                id: r.get(0)?,
                title: r.get(1)?,
                done: r.get(2)?,
                created_at: r.get(3)?,
                done_at: r.get(4)?,
                position: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn todo_add(&self, title: &str) -> WidgetResult<Todo> {
        let title = clean_title(title)?;
        let pos: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM todos", [], |r| r.get(0))?;
        let todo = Todo {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            done: false,
            created_at: crate::now_ms(),
            done_at: None,
            position: pos,
        };
        self.conn.execute(
            "INSERT INTO todos (id, title, done, created_at, done_at, position) VALUES (?1, ?2, 0, ?3, NULL, ?4)",
            params![todo.id, todo.title, todo.created_at, todo.position],
        )?;
        Ok(todo)
    }

    pub fn todo_set_done(&self, id: &str, done: bool) -> WidgetResult<()> {
        let n = self.conn.execute(
            "UPDATE todos SET done = ?2, done_at = CASE WHEN ?2 THEN ?3 ELSE NULL END WHERE id = ?1",
            params![id, done, crate::now_ms()],
        )?;
        if n == 0 {
            return Err(WidgetError::NotFound("task".into()));
        }
        Ok(())
    }

    pub fn todo_rename(&self, id: &str, title: &str) -> WidgetResult<()> {
        let title = clean_title(title)?;
        self.conn
            .execute("UPDATE todos SET title = ?2 WHERE id = ?1", params![id, title])?;
        Ok(())
    }

    pub fn todo_delete(&self, id: &str) -> WidgetResult<()> {
        self.conn.execute("DELETE FROM todos WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn todo_clear_done(&self) -> WidgetResult<usize> {
        Ok(self.conn.execute("DELETE FROM todos WHERE done = 1", [])?)
    }

    /// Persist a new order for open tasks (ids in display order).
    pub fn todo_reorder(&mut self, ids: &[String]) -> WidgetResult<()> {
        let tx = self.conn.transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute("UPDATE todos SET position = ?2 WHERE id = ?1", params![id, i as i64 + 1])?;
        }
        tx.commit()?;
        Ok(())
    }
}
