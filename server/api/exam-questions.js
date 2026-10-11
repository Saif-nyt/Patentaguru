import { getCollection } from './_db.js';
import { setCors, rateLimit, clientIp, rateLimited, serverError } from './_http.js';

/**
 * GET /api/exam-questions
 * Query parameters:
 *  - count: number of questions (default 30, max 60)
 *  - chapter: optional chapter filter (1-25)
 *
 * Returns randomized questions sampled directly from the official question bank.
 */
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const limitCheck = rateLimit(`exam-questions:${clientIp(req)}`, 30, 60_000);
    if (!limitCheck.ok) return rateLimited(res, limitCheck.retryAfterSec);

    const questionsCol = await getCollection('questions');

    const requestedCount = parseInt(req.query.count || '30', 10);
    const limit = Math.min(Math.max(isNaN(requestedCount) ? 30 : requestedCount, 1), 60);

    const filter = {};
    if (req.query.chapter) {
      filter.chapterNum = parseInt(req.query.chapter, 10);
    }

    // High performance MongoDB aggregation using $sample to pick random questions across chapters
    const pipeline = [];
    if (Object.keys(filter).length > 0) {
      pipeline.push({ $match: filter });
    }
    pipeline.push({ $sample: { size: limit } });
    pipeline.push({
      $project: {
        _id: 0,
        id: 1,
        officialId: 1,
        id_argument: 1,
        chapterId: 1,
        chapterNum: 1,
        chapterTitleIt: 1,
        questionIt: 1,
        questionBn: 1,
        isCorrect: 1,
        image: 1,
        type: 1,
        hasTranslation: 1,
      }
    });

    const questions = await questionsCol.aggregate(pipeline).toArray();

    // Map to client QuizQuestion shape
    const formatted = questions.map((q) => ({
      id: q.id || `q_${q.officialId}`,
      chapterId: q.chapterId,
      chapterTitleIt: q.chapterTitleIt,
      chapterTitleBn: `চ্যাপ্টার ${q.chapterNum}: ${q.chapterTitleIt}`,
      questionIt: q.questionIt,
      questionBn: q.questionBn || '',
      isCorrect: q.isCorrect,
      explanationBn: q.isCorrect
        ? 'সঠিক (VERO)! ইতালির অফিশিয়াল ট্রাফিক কোড (Codice della Strada) অনুযায়ী এই বক্তব্যটি শতভাগ আইনসম্মত ও সত্য।'
        : 'ভুল (FALSO)! ইতালির সরকারি ট্রাফিক বিধিমালার সাথে এই বক্তব্যটি সাংঘর্ষিক এবং পরীক্ষায় এটি ভুল উত্তর।',
      image: q.image || undefined,
      vocabulary: [],
    }));

    // Cache header: cache for 10 seconds, stale-while-revalidate for 60
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
    return res.status(200).json({
      success: true,
      count: formatted.length,
      totalBankSize: 7165,
      questions: formatted
    });
  } catch (error) {
    return serverError(res, 'exam-questions', error);
  }
}
