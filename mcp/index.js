#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DATA_DIR  = join(homedir(), 'Library', 'Application Support', 'menutodo');
const DATA_FILE = join(DATA_DIR, 'tasks.json');

const COLOR_PALETTE = ['#6366f1','#3b82f6','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#a855f7'];

function readData() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { tasks: [], projects: [] };
  }
}

function writeData(data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getNextColor(projects) {
  const used = projects.map(p => p.color);
  return COLOR_PALETTE.find(c => !used.includes(c)) ?? COLOR_PALETTE[projects.length % COLOR_PALETTE.length];
}

function resolveProject(data, name) {
  if (!name) return null;
  const existing = (data.projects || []).find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  if (!data.projects) data.projects = [];
  const project = { id: randomUUID(), name, color: getNextColor(data.projects) };
  data.projects.push(project);
  return project.id;
}

function formatTask(task, projects) {
  const project = task.projectId ? (projects || []).find(p => p.id === task.projectId) : null;
  return {
    id:         task.id,
    title:      task.title,
    bucket:     task.bucket,
    deadline:   task.deadline || null,
    project:    project ? project.name : null,
    completed:  task.completed,
    created_at: task.createdAt,
  };
}

const server = new Server(
  { name: 'menutodo', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_tasks',
      description: "Returns the user's task list. Use when the user asks about their tasks, or when context about current workload is needed. Call with filter 'anytime' at the start of a work session to understand what's in the backlog.",
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['today', 'anytime', 'all'],
            description: "Which bucket to return. Omit or use 'all' for everything.",
          },
        },
      },
    },
    {
      name: 'add_task',
      description: "Adds a task to the user's todo list. Use proactively when the conversation implies something needs to be tracked or done later, even if the user doesn't explicitly ask. If project is not clear from context, ask once before adding.",
      inputSchema: {
        type: 'object',
        properties: {
          title:    { type: 'string', description: 'Task title' },
          bucket:   { type: 'string', enum: ['today', 'anytime'], description: "Bucket to add to. Defaults to 'anytime'." },
          deadline: { type: 'string', description: 'Due date as YYYY-MM-DD. Optional.' },
          project:  { type: 'string', description: 'Project name. Created automatically if it does not exist. Optional.' },
        },
        required: ['title'],
      },
    },
    {
      name: 'complete_task',
      description: 'Marks a task as complete. Use proactively when the conversation indicates a task has been finished.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID from list_tasks' },
        },
        required: ['id'],
      },
    },
    {
      name: 'update_task',
      description: "Updates an existing task. Use when the user asks to modify a task's title, deadline, bucket, or project.",
      inputSchema: {
        type: 'object',
        properties: {
          id:       { type: 'string', description: 'Task ID from list_tasks' },
          title:    { type: 'string', description: 'New title' },
          bucket:   { type: 'string', enum: ['today', 'anytime'], description: 'Move to a different bucket' },
          deadline: { type: 'string', description: 'New deadline as YYYY-MM-DD. Pass empty string to remove.' },
          project:  { type: 'string', description: 'New project name. Pass empty string to remove.' },
        },
        required: ['id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const data = readData();

  if (name === 'list_tasks') {
    const filter = args?.filter || 'all';
    const tasks = data.tasks.filter(t => filter === 'all' || (!t.completed && t.bucket === filter));
    return {
      content: [{ type: 'text', text: JSON.stringify(tasks.map(t => formatTask(t, data.projects)), null, 2) }],
    };
  }

  if (name === 'add_task') {
    const projectId = resolveProject(data, args.project);
    const task = {
      id:          randomUUID(),
      title:       args.title,
      bucket:      args.bucket || 'anytime',
      completed:   false,
      createdAt:   new Date().toISOString(),
      completedAt: null,
      projectId,
      deadline:    args.deadline || null,
    };
    data.tasks.unshift(task);
    writeData(data);
    const project = projectId ? data.projects.find(p => p.id === projectId) : null;
    return {
      content: [{ type: 'text', text: `Added "${task.title}" to ${task.bucket}${task.deadline ? ` · due ${task.deadline}` : ''}${project ? ` · ${project.name}` : ''}` }],
    };
  }

  if (name === 'complete_task') {
    const task = data.tasks.find(t => t.id === args.id);
    if (!task) return { content: [{ type: 'text', text: `Task not found: ${args.id}` }] };
    task.completed   = true;
    task.completedAt = new Date().toISOString();
    writeData(data);
    return { content: [{ type: 'text', text: `Completed: "${task.title}"` }] };
  }

  if (name === 'update_task') {
    const task = data.tasks.find(t => t.id === args.id);
    if (!task) return { content: [{ type: 'text', text: `Task not found: ${args.id}` }] };
    if (args.title    !== undefined) task.title     = args.title;
    if (args.bucket   !== undefined) task.bucket    = args.bucket;
    if (args.deadline !== undefined) task.deadline  = args.deadline || null;
    if (args.project  !== undefined) task.projectId = args.project ? resolveProject(data, args.project) : null;
    writeData(data);
    return { content: [{ type: 'text', text: `Updated: "${task.title}"` }] };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
