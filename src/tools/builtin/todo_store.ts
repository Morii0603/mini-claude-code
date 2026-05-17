export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

let todos: TodoItem[] = [];

export function getTodos(): TodoItem[] {
  return todos;
}

export function setTodos(newTodos: TodoItem[]): void {
  todos = newTodos;
}

export function clearTodos(): void {
  todos = [];
}
