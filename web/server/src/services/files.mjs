import { access, readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import YAML from 'yaml';

export async function readYaml(filePath) {
  try {
    return YAML.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listFilesRecursive(root, extension) {
  if (!await exists(root)) return [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => resolve(entry.parentPath ?? entry.path, entry.name));
}

export function relativePosix(root, filePath) {
  return relative(root, filePath).split(sep).join('/');
}

export async function fileMtime(filePath) {
  try {
    return (await stat(filePath)).mtime.toISOString();
  } catch (error) {
    if (error.code === 'ENOENT') return new Date(0).toISOString();
    throw error;
  }
}
