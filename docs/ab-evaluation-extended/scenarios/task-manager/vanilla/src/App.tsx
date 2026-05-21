import {useState} from 'react';
import {Header} from './components/Header';
import {Footer} from './components/Footer';
import {TaskList} from './components/TaskList';
import {AddTaskForm} from './components/AddTaskForm';
import {FilterBar} from './components/FilterBar';
import {ThemeToggle} from './components/ThemeToggle';
import {CategoryManager} from './components/CategoryManager';
import {TaskDetailModal} from './components/TaskDetailModal';
import {useTasks} from './hooks/useTasks';
import {useTheme} from './hooks/useTheme';
import {useCategories} from './hooks/useCategories';
import {useKeyboardShortcuts} from './hooks/useKeyboardShortcuts';
import {applyFilter, applySearch, sortByCreated} from './lib/filter';
import {exportToJson, importFromJson} from './lib/export-import';
import type {Filter, Task} from './lib/types';

export function App() {
  const [filter, setFilter] = useState<Filter>({status: 'all'});
  const [search, setSearch] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const {tasks, addTask, updateTask, removeTask, toggleDone, clearDone} = useTasks();
  const {categories, addCategory, updateCategory, removeCategory} = useCategories();
  const {theme, setTheme} = useTheme();

  useKeyboardShortcuts({onNew: () => document.getElementById('tm-new-task-input')?.focus()});

  const visible = sortByCreated(applyFilter(applySearch(tasks, search), filter));
  const open = tasks.find((t) => t.id === openTaskId) ?? null;

  return (
    <div className="tm-container max-w-2xl mx-auto p-4 space-y-4">
      <Header />
      <div className="flex items-center justify-between gap-2">
        <ThemeToggle theme={theme} onChange={setTheme} />
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            const json = exportToJson(tasks, categories);
            const blob = new Blob([json], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tasks.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </button>
      </div>
      <AddTaskForm onAdd={addTask} />
      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        categories={categories}
      />
      <TaskList
        tasks={visible}
        onToggleDone={toggleDone}
        onRemove={removeTask}
        onOpen={(t: Task) => setOpenTaskId(t.id)}
        onClearDone={clearDone}
        onRename={(id, title) => updateTask(id, {title})}
      />
      <CategoryManager
        categories={categories}
        onAdd={addCategory}
        onUpdate={updateCategory}
        onRemove={removeCategory}
      />
      {open ? (
        <TaskDetailModal
          task={open}
          categories={categories}
          onClose={() => setOpenTaskId(null)}
          onSave={(patch) => {
            updateTask(open.id, patch);
            setOpenTaskId(null);
          }}
        />
      ) : null}
      <Footer
        visibleCount={visible.length}
        onImport={(json) => {
          const result = importFromJson(json);
          if (result) {
            // restored state would replace local arrays; left as a sketch
          }
        }}
      />
    </div>
  );
}
