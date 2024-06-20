import { RedisClientType, createClient } from "redis";

const client = createClient();

client.on("error", (error) => console.log("Redis Client Error", error));

await client.connect();

const ONE_WEEK_IN_SECONDS = 7 * 86400;
const VOTE_SCORE = 432;
const ARTICLES_PER_PAGE = 25;

async function articleVote(
  client: RedisClientType,
  user: string,
  article: string
) {
  const cutoff = Date.now() / 1000 - ONE_WEEK_IN_SECONDS;
  const postCreatedTime = await client.zScore("time:", article);
  if (postCreatedTime && postCreatedTime < cutoff) {
    return;
  }

  const articleId = article.split(":")[-1];
  const addResult = await client.sAdd("voted:" + articleId, user);
  if (!!addResult) {
    await client.zIncrBy("score:", VOTE_SCORE, user);
    await client.hIncrBy(article, "votes", 1);
  }
}

async function postArticle(
  client: RedisClientType,
  user: string,
  title: string,
  link: string
) {
  const articleId = await client.incr("article:");
  const voted = "voted:" + articleId;
  await client.sAdd(voted, user);
  await client.expire(voted, ONE_WEEK_IN_SECONDS);

  const now = Date.now() / 1000;
  const article = "article:" + articleId;
  await client.hSet(article, {
    title,
    link,
    poster: user,
    time: now,
    votes: 1,
  });

  await client.zAdd("score:", {
    score: now + VOTE_SCORE,
    value: article,
  });
  await client.zAdd("time:", {
    score: now,
    value: article,
  });
  return articleId;
}

async function getArticles(
  client: RedisClientType,
  page: number,
  order: "score:" | "time:" = "score:"
) {
  const start = (page-1) * ARTICLES_PER_PAGE;
  const end = start + ARTICLES_PER_PAGE - 1;

  const ids = await client.zRange(order, start, end, {
    REV: true 
  })
  const articles: {[key: string]: string}[] = []
  for (let id of ids) {
    const articleData = await client.hGetAll(id)
    articleData['id'] = id
    articles.push(articleData)
  } 
  return articles;
}
