import { createFileTool, createFileSchema, type CreateFileArgs, executeCreateFile } from './create-file.js';
import { editFileTool, editFileSchema, type EditFileArgs, executeEditFile } from './edit-file.js';
import { renameFileTool, renameFileSchema, type RenameFileArgs, executeRenameFile } from './rename-file.js';
import { deleteFileTool, deleteFileSchema, type DeleteFileArgs, executeDeleteFile } from './delete-file.js';
import { addDependencyTool, addDependencySchema, type AddDependencyArgs, executeAddDependency } from './add-dependency.js';
import { submitWorkTool, submitWorkSchema, type SubmitWorkArgs, executeSubmitWork } from './submit-work.js';
import { askUserTool, askUserSchema, type AskUserArgs, executeAskUser } from './ask-user.js';

export {
  createFileTool,
  createFileSchema,
  editFileTool,
  editFileSchema,
  renameFileTool,
  renameFileSchema,
  deleteFileTool,
  deleteFileSchema,
  addDependencyTool,
  addDependencySchema,
  submitWorkTool,
  submitWorkSchema,
  askUserTool,
  askUserSchema,
  executeCreateFile,
  executeEditFile,
  executeRenameFile,
  executeDeleteFile,
  executeAddDependency,
  executeSubmitWork,
  executeAskUser,
};

export type {
  CreateFileArgs,
  EditFileArgs,
  RenameFileArgs,
  DeleteFileArgs,
  AddDependencyArgs,
  SubmitWorkArgs,
  AskUserArgs,
};

export const allTools = {
  create_file: createFileTool,
  edit_file: editFileTool,
  rename_file: renameFileTool,
  delete_file: deleteFileTool,
  add_dependency: addDependencyTool,
  submit_work: submitWorkTool,
  ask_user: askUserTool,
};

export type { ToolExecutionResult } from './types.js';
