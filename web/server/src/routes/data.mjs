import { Router } from 'express';
import { readFile } from 'node:fs/promises';

import {
  getApplications,
  getPipeline,
  getScanHistory,
  getReports,
  getReportByNumber,
  getStoryBank,
  getProfile,
  getPortals,
  getCv,
  getHistory,
  getPdfFiles,
  getInterviewPrepFiles,
  getInterviewPrep,
  getComparisons,
  getComparisonRaw,
} from '../services/data.mjs';
import { notFound } from '../utils/errors.mjs';
import { projectPath } from '../utils/paths.mjs';

export const dataRouter = Router();

const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

dataRouter.get('/applications', asyncRoute(async (_req, res) => res.json(await getApplications())));

dataRouter.get('/pipeline', asyncRoute(async (_req, res) => res.json(await getPipeline())));

dataRouter.get('/scan-history', asyncRoute(async (_req, res) => res.json(await getScanHistory())));

dataRouter.get('/reports', asyncRoute(async (_req, res) => res.json(await getReports())));

dataRouter.get('/reports/:num', asyncRoute(async (req, res) => {
  const num = Number(req.params.num);
  if (!Number.isInteger(num)) throw notFound('无效的报告编号');
  res.json(await getReportByNumber(num, { detail: true, reportPath: req.query.path }));
}));

dataRouter.get('/comparisons', asyncRoute(async (_req, res) => res.json(await getComparisons())));

dataRouter.get('/comparisons/:filename', asyncRoute(async (req, res) => {
  res.type('text/markdown').send(await getComparisonRaw(req.params.filename));
}));

dataRouter.get('/story-bank', asyncRoute(async (_req, res) => res.json(await getStoryBank())));

dataRouter.get('/profile', asyncRoute(async (_req, res) => res.json(await getProfile())));

dataRouter.get('/portals', asyncRoute(async (_req, res) => res.json(await getPortals())));

dataRouter.get('/cv', asyncRoute(async (_req, res) => res.json(await getCv())));

dataRouter.get('/history/:kind', asyncRoute(async (req, res) => {
  const kind = req.params.kind;
  if (!['task', 'activity', 'metrics'].includes(kind)) throw notFound(`未知历史类型: ${kind}`);
  res.json(await getHistory(kind));
}));

dataRouter.get('/pdfs', asyncRoute(async (_req, res) => res.json(await getPdfFiles())));

dataRouter.get('/interview-prep', asyncRoute(async (_req, res) => res.json(await getInterviewPrepFiles())));

dataRouter.get('/interview-prep/:slug', asyncRoute(async (req, res) => {
  res.type('text/markdown').send(await getInterviewPrep(req.params.slug));
}));
