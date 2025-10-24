import React, { useEffect, useMemo, useRef, useState } from "react";

// ============================================================
// MVVM Todo App — Browser/React version (single file)
// Demonstrates: MVVM, Factory, Builder, Singleton, Adapter, Decorator,
// Proxy, Observer, Strategy, Command, Reactive, Advanced TS Types
// ============================================================
type TodoStatus = "pending" | "done";

type Todo = {
  id: number,
  title: string,
  status: TodoStatus
};


export type ReadonlyTodo = Readonly<Todo>;
export type OptionalTodo = Partial<Todo>;
export type ExtractStatus<T> = T extends { status: infer S} ? S : never;
export type StatusType = ExtractStatus<Todo>;


function isTodo(x: any) {
  return x && typeof x.id === "number" && typeof x.title === "string";
}

class TodoBuilder {
  private todo: OptionalTodo = {};
  setId(id: number) { this.todo.id = id; return this; }
  setTitle(title: string) { this.todo.title = title; return this; }
  setStatus(status: TodoStatus) { this.todo.status = status; return this; }
  build(): Todo {
    if (this.todo.id == null) throw new Error("Todo id missing");
    if (!this.todo.title) throw new Error("Todo title missing");
    return { status: "pending", ...this.todo } as Todo;
  }
}

class TodoRepository {
  private static instance?: TodoRepository;
  private todos: Todo[] = [];
  private constructor() {}
  static getInstance() {
    if (!this.instance) this.instance = new TodoRepository();
    return this.instance;
  }
  add(todo: Todo) { this.todos.push(todo); }
  update(id: number, patch: OptionalTodo) {
    const t = this.todos.find(t => t.id === id);
    if (t) Object.assign(t, patch);
  }
  updateStatus(id: number, status: StatusType) {
    const t = this.todos.find(t => t.id === id);
    if (t) t.status = status;
  }
  remove(id: number) { this.todos = this.todos.filter(t => t.id !== id); }
  all() { return [...this.todos]; }
  setAll(todos: Todo[]) { this.todos = [...todos]; }
}

class TodoFactory {
  static create(title: string): Todo {
    return new TodoBuilder()
      .setId(Date.now() + Math.floor(Math.random() * 1000))
      .setTitle(title.trim())
      .setStatus("pending")
      .build();
  }
}

type Listener<T> = (data: T) => void;
class EventEmitter<T> {
  private listeners: Set<Listener<T>> = new Set();
  on(fn: Listener<T>) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(data: T) { this.listeners.forEach(fn => fn(data)); }
}

interface SortStrategy { sort(todos: Todo[]): Todo[]; name: string; }
class SortByTitle implements SortStrategy {
  name = "Title A→Z";
  sort(todos: Todo[]) { return [...todos].sort((a,b) => a.title.localeCompare(b.title)); }
}
class SortByStatus implements SortStrategy {
  name = "Status";
  sort(todos: Todo[]) { return [...todos].sort((a,b) => a.status.localeCompare(b.status) || a.title.localeCompare(b.title)); }
}
class SortByCreatedDesc implements SortStrategy {
  name = "Created (newest)";
  sort(todos: Todo[]) { return [...todos].sort((a,b) => b.id - a.id); }
}

const STRATEGIES: SortStrategy[] = [new SortByCreatedDesc(), new SortByTitle(), new SortByStatus()];

interface Command { execute(): void; label: string }
class AddTodoCommand implements Command {
  constructor(private repo: TodoRepository, private todo: Todo) {}
  label = "Add";
  execute() { this.repo.add(this.todo); }
}
class ToggleTodoCommand implements Command {
  constructor(private repo: TodoRepository, private id: number) {}
  label = "Toggle";
  execute() {
    const t = this.repo.all().find(t => t.id === this.id);
    if (t) {
      const newStatus: StatusType = t.status === "pending" ? "done" : "pending";
      this.repo.updateStatus(this.id, newStatus);
    }
  }
}
class RemoveTodoCommand implements Command {
  constructor(private repo: TodoRepository, private id: number) {}
  label = "Remove";
  execute() { this.repo.remove(this.id); }
}

interface StoragePort {
  load(): Promise<Todo[]>;
  save(todos: Todo[]): Promise<void>;
}

class LocalStorageAdapter implements StoragePort {
  constructor(private key: string) {}
  async load(): Promise<Todo[]> {
    const raw = localStorage.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isTodo) : [];
    } catch { return []; }
  }
  async save(todos: Todo[]): Promise<void> {
    localStorage.setItem(this.key, JSON.stringify(todos));
  }
}

function withLogging<T extends object, K extends keyof T>(obj: T, key: K): void {
  const original = obj[key];
  if (typeof original !== "function") return;
  (obj as any)[key] = function(...args: any[]) {
    console.log(`→ ${String(key)}(`, ...args, ")");
    const res = (original as any).apply(this, args);
    return res;
  };
}

type ViewState = { todos: Todo[]; strategyName: string };

class TodoViewModel {
  private repo = TodoRepository.getInstance();
  private emitter = new EventEmitter<ViewState>();
  private strategy: SortStrategy = STRATEGIES[0];
  constructor(private storage: StoragePort){ }

  private _decorated = (() => {
    ["addTodo","toggleTodo","removeTodo","setStrategy","load","save"].forEach((k) => withLogging(this as any, k as any));
    return true;
  })();

  onChange(fn: Listener<ViewState>) { return this.emitter.on(fn); }

  async load() {
    const data = await this.storage.load();
    this.repo.setAll(data);
    this.notify();
  }
  async save() {
    await this.storage.save(this.repo.all());
  }

  addTodo(title: string) {
    const todo = TodoFactory.create(title);
    new AddTodoCommand(this.repo, todo).execute();
    this.notify();
    this.save();
  }
  toggleTodo(id: number) {
    new ToggleTodoCommand(this.repo, id).execute();
    this.notify();
    this.save();
  }
  removeTodo(id: number) {
    new RemoveTodoCommand(this.repo, id).execute();
    this.notify();
    this.save();
  }
  setStrategy(strategy: SortStrategy) {
    this.strategy = strategy;
    this.notify();
  }

  // Demonstration of using StatusType directly in a method
  setSpecificStatus(id: number, status: StatusType) {
    this.repo.updateStatus(id, status);
    this.notify();
    this.save();
  }

  private notify() {
    const todos = this.strategy.sort(this.repo.all());
    this.emitter.emit({ todos, strategyName: this.strategy.name });
  }
}

function createVMProxy(vm: TodoViewModel): TodoViewModel {
  return new Proxy(vm, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === "function") {
        return (...args: any[]) => {
          console.log(`(Proxy) ${String(prop)} called`);
          return (val as Function).apply(target, args);
        };
      }
      return val;
    },
  });
}

export default function App() {
  const storage = useMemo(() => new LocalStorageAdapter("mvvm_todos"), []);
  const [vm] = useState(() => createVMProxy(new TodoViewModel(storage)));
  const [todos, setTodos] = useState<Todo[]>([]);
  const [strategyName, setStrategyName] = useState<string>(STRATEGIES[0].name);
  const [title, setTitle] = useState("");

  useEffect(() => {
    const unsub = vm.onChange(({ todos, strategyName }) => {
      setTodos(todos);
      setStrategyName(strategyName);
    });
    vm.load();
    return () => { unsub?.(); };
  }, [vm]);

  const StatusBadge: React.FC<{ status: TodoStatus }> = ({ status }) => (
    <span className={`px-2 py-0.5 text-xs rounded-full ${status === "done" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
      {status}
    </span>
  );

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-3xl mx-auto p-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">MVVM Todo Manager1</h1>
          <div className="text-sm opacity-70">Strategy: <span className="font-medium">{strategyName}</span></div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <div className="md:col-span-2 flex gap-2">
            <input
              className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Add a new todo (e.g. 'Write docs')"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) { vm.addTodo(title); setTitle(""); } }}
            />
            <button
              className="rounded-xl px-4 py-2 bg-indigo-600 text-white shadow hover:shadow-md active:scale-[.99] transition"
              onClick={() => { if (title.trim()) { vm.addTodo(title); setTitle(""); } }}
            >Add</button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm">Sort:</label>
            <select
              className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={strategyName}
              onChange={(e) => {
                const s = STRATEGIES.find(x => x.name === e.target.value)!;
                vm.setStrategy(s);
              }}
            >
              {STRATEGIES.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          {todos.length === 0 && (
            <div className="text-sm text-neutral-500">No todos yet. Add one above!</div>
          )}
          {todos.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-white rounded-2xl border border-neutral-200 p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <input
                  id={`chk-${t.id}`}
                  type="checkbox"
                  className="h-5 w-5 accent-indigo-600"
                  checked={t.status === "done"}
                  onChange={() => vm.toggleTodo(t.id)}
                />
                <label htmlFor={`chk-${t.id}`} className={`select-none ${t.status === "done" ? "line-through text-neutral-400" : ""}`}>
                  {t.title}
                </label>
                <StatusBadge status={t.status} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs rounded-lg px-3 py-1 border border-neutral-300 hover:bg-neutral-50"
                  onClick={() => vm.setSpecificStatus(t.id, "done")}
                >Mark Done</button>
                <button
                  className="text-xs rounded-lg px-3 py-1 border border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => vm.removeTodo(t.id)}
                >Delete</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 text-xs text-neutral-500 space-y-1">
          <div>Demonstrates StatusType usage: The 'Mark Done' button calls a ViewModel method that uses StatusType.</div>
        </div>
      </div>
    </div>
  );
}
// import React, { useEffect, useMemo, useRef, useState } from "react";

// // ============================================================
// // MVVM Todo App — Browser/React version (single file)
// // Demonstrates: MVVM, Factory, Builder, Singleton, Adapter, Decorator,
// // Proxy, Observer, Strategy, Command, Reactive, Advanced TS Types
// // ============================================================

// type TodoStatus = /* todo */

// type Todo = /* todo */


// export type ReadonlyTodo = /* todo */
// export type OptionalTodo = /* todo */
// export type ExtractStatus<T> = /* todo */
// export type StatusType = /* todo */

// function isTodo(x: any): /* todo */

// class TodoBuilder {
//   private todo: /* todo */
//   setId(id: number) { /* todo */}
//   setTitle(title: string) { /* todo */ }
//   setStatus(status: TodoStatus) { /* todo */ }
//   build(): Todo {
//     /* todo */
//   }
// }

// class TodoRepository {
//   private static instance?: /* todo */
//   private todos: Todo[] = [];
//   private constructor() {}
//   static getInstance() {
//     /* todo */
//   }
//   add(todo: Todo) { /* todo */}
//   update(id: number, patch: OptionalTodo) {
//     /* todo */
//   }
//   updateStatus(id: number, status: StatusType) {
//     /* todo */
//   }
//   remove(id: number) { /* todo */ }
//   all() { /* todo */}
//   setAll(todos: Todo[]) { /* todo */ }
// }

// class TodoFactory {
//   static create(title: string): /* todo */
// }

// type Listener<T> = /* todo */
// class EventEmitter<T> {
//   /* todo */
// }

// interface SortStrategy { /* todo */ }
// class SortByTitle implements SortStrategy {
//   /* todo */
// }
// class SortByStatus implements SortStrategy {
//   /* todo */
// }
// class SortByCreatedDesc implements SortStrategy {
//  /* todo */
// }

// const STRATEGIES: SortStrategy[] = [/* todo */];

// interface Command { /* todo */ }
// class AddTodoCommand implements Command {
//   /* todo */
// }
// class ToggleTodoCommand implements Command {
//   constructor(private repo: TodoRepository, private id: number) {}
//   label = "Toggle";
//   execute() {
//     /* todo */
//   }
// }
// class RemoveTodoCommand implements Command {
//   constructor(private repo: TodoRepository, private id: number) {}
//   label = "Remove";
//   execute() {/* todo */ }
// }

// interface StoragePort {
//   load(): /* todo */
//   save(todos: Todo[]):/* todo */
// }

// class LocalStorageAdapter implements StoragePort {
//   constructor(private key: string) {}
//   async load(): Promise<Todo[]> {
//    /* todo */
//   }
//   async save(todos: Todo[]): Promise<void> {
//     /* todo */
//   }
// }

// function withLogging<T extends object, K extends keyof T>(obj: T, key: K): void {
//   /* todo */
// }

// type ViewState = { todos: Todo[]; strategyName: string };

// class TodoViewModel {
//   private repo = /* todo */
//   private emitter = /* todo */
//   private strategy: SortStrategy = /* todo */
//   constructor(private storage: StoragePort){ }

//   private _decorated = (() => {
//    /* todo */
//   })();

//   onChange(/* todo */ }

//   async load() {
// /* todo */
//   }
//   async save() {
// /* todo */  }

//   addTodo(title: string) {
//    /* todo */
//   }
//   toggleTodo(id: number) {
//     /* todo */
//   }
//   removeTodo(id: number) {
// /* todo */
//   }
//   setStrategy(strategy: SortStrategy) {
// /* todo */
//   }

//   // Demonstration of using StatusType directly in a method
//   setSpecificStatus(id: number, status: StatusType) {
// /* todo */
//   }

//   private notify() {
// /* todo */
//   }
// }

// function createVMProxy(vm: TodoViewModel): TodoViewModel {
//   /* todo */
// }

// export default function App() {
//   const storage =/* todo */
//   const [vm] = /* todo */
//   const [todos, setTodos] = useState<Todo[]>([]);
//   const [strategyName, setStrategyName] = useState<string>(STRATEGIES[0].name);
//   const [title, setTitle] = useState("");

//   useEffect(/* todo */);

//   const StatusBadge: React.FC<{ status: TodoStatus }> = ({ status }) => (
//     <span className={`px-2 py-0.5 text-xs rounded-full ${status === "done" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
//       {status}
//     </span>
//   );

//   return (
//     <div className="min-h-screen bg-neutral-50 text-neutral-900">
//       <div className="max-w-3xl mx-auto p-6">
//         <header className="flex items-center justify-between mb-6">
//           <h1 className="text-2xl font-bold">MVVM Todo Manager1</h1>
//           <div className="text-sm opacity-70">Strategy: <span className="font-medium">{strategyName}</span></div>
//         </header>

//         <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
//           <div className="md:col-span-2 flex gap-2">
//             <input
//               className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               placeholder="Add a new todo (e.g. 'Write docs')"
//               value={title}
//               onChange={(e) => setTitle(e.target.value)}
//               onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) { vm.addTodo(title); setTitle(""); } }}
//             />
//             <button
//               className="rounded-xl px-4 py-2 bg-indigo-600 text-white shadow hover:shadow-md active:scale-[.99] transition"
//               onClick={() => { if (title.trim()) { vm.addTodo(title); setTitle(""); } }}
//             >Add</button>
//           </div>

//           <div className="flex items-center gap-2">
//             <label className="text-sm">Sort:</label>
//             <select
//               className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
//               value={strategyName}
//               onChange={(e) => {
//                 const s = STRATEGIES.find(x => x.name === e.target.value)!;
//                 vm.setStrategy(s);
//               }}
//             >
//               {STRATEGIES.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
//             </select>
//           </div>
//         </div>

//         <div className="space-y-2">
//           {todos.length === 0 && (
//             <div className="text-sm text-neutral-500">No todos yet. Add one above!</div>
//           )}
//           {todos.map(t => (
//             <div key={t.id} className="flex items-center justify-between bg-white rounded-2xl border border-neutral-200 p-3 shadow-sm">
//               <div className="flex items-center gap-3">
//                 <input
//                   id={`chk-${t.id}`}
//                   type="checkbox"
//                   className="h-5 w-5 accent-indigo-600"
//                   checked={t.status === "done"}
//                   onChange={() => vm.toggleTodo(t.id)}
//                 />
//                 <label htmlFor={`chk-${t.id}`} className={`select-none ${t.status === "done" ? "line-through text-neutral-400" : ""}`}>
//                   {t.title}
//                 </label>
//                 <StatusBadge status={t.status} />
//               </div>
//               <div className="flex items-center gap-2">
//                 <button
//                   className="text-xs rounded-lg px-3 py-1 border border-neutral-300 hover:bg-neutral-50"
//                   onClick={() => vm.setSpecificStatus(t.id, "done")}
//                 >Mark Done</button>
//                 <button
//                   className="text-xs rounded-lg px-3 py-1 border border-red-300 text-red-700 hover:bg-red-50"
//                   onClick={() => vm.removeTodo(t.id)}
//                 >Delete</button>
//               </div>
//             </div>
//           ))}
//         </div>

//         <div className="mt-8 text-xs text-neutral-500 space-y-1">
//           <div>Demonstrates StatusType usage: The 'Mark Done' button calls a ViewModel method that uses StatusType.</div>
//         </div>
//       </div>
//     </div>
//   );
// }

