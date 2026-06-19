use std::sync::Arc;

use sf_core::{ProcessRunner, SfInvoker};
use tauri::State;

/// Shared application state: one `SfInvoker` over the real `sf` CLI process runner.
pub struct AppState {
    invoker: SfInvoker,
}

/// Flat, table-shaped query result handed to the frontend.
#[derive(serde::Serialize)]
struct TableDto {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    total_size: u64,
}

#[tauri::command]
async fn run_soql(query: String, state: State<'_, AppState>) -> Result<TableDto, String> {
    let table = features::soql::run_query_table(&state.invoker, &query)
        .await
        .map_err(|e| format!("{e:?}"))?;
    let total_size = table.rows.len() as u64;
    Ok(TableDto {
        columns: table.columns,
        rows: table.rows,
        total_size,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        invoker: SfInvoker::new(Arc::new(ProcessRunner)),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![run_soql])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
