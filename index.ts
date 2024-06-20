import { RedisClientType, createClient } from "redis";

const ONE_WEEK_IN_SECONDS = 7 * 86400;
const VOTE_SCORE = 432;
const ARTICLES_PER_PAGE = 25;

async function articleVote(
  client: RedisClientType,
  user: string,
  article: string,
  downVoted: boolean = false
) {
  const cutoff = Date.now() / 1000 - ONE_WEEK_IN_SECONDS;
  const postCreatedTime = await client.zScore("time:", article);
  if (postCreatedTime && postCreatedTime < cutoff) {
    return;
  }

  const articleId = article.split(":")[-1];
  if (!downVoted) {
    const addResult = await client.sAdd("voted:" + articleId, user);
    if (!!addResult) {
      await client.zIncrBy("score:", VOTE_SCORE, article);
      await client.hIncrBy(article, "votes", 1);
    }
  } else {
    const addResult = await client.sAdd("down-voted:" + articleId, user);
    if (!!addResult) {
      await client.zIncrBy("score:", -VOTE_SCORE, article);
      await client.hIncrBy(article, "votes", 1);
    }
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
  order: "score:" | "time:" | string = "score:"
) {
  const start = (page - 1) * ARTICLES_PER_PAGE;
  const end = start + ARTICLES_PER_PAGE - 1;

  const ids = await client.zRange(order, start, end, {
    REV: true,
  });
  const articles: any[] = [];
  console.log("ids", ids);
  for (let id of ids) {
    const articleData = await client.hGetAll(id);
    articleData["id"] = id;
    articles.push(articleData);
  }
  return articles;
}

async function addRemoveGroups(
  client: RedisClientType,
  articleId: number,
  toAdd: string[] | null = null,
  toRemove: string[] | null = null
) {
  const article = "article:" + articleId;
  if (toAdd) {
    for (let group of toAdd) {
      client.sAdd("group:" + group, article);
    }
  }
  if (toRemove) {
    for (let group of toRemove) {
      client.sRem("group:" + group, article);
    }
  }
}

async function getGroupArticles(
  client: RedisClientType,
  group: string,
  page: number,
  order: "score:" | "time:" = "score:"
) {
  const key = order + group;
  const exists = await client.exists(key);
  if (!exists) {
    client.zInterStore(key, ["group" + group, order], {
      AGGREGATE: "MAX",
    });
    client.expire(key, 60);
  }
  return getArticles(client, page, key);
}

async function main() {
  const client = await createClient()
    .on("error", (error) => console.log("Redis Client Error", error))
    .connect();

  const user = "user:123";
  const user2 = "user:124";
  await client.set("article:", 0);
  const postId = await postArticle(
    client as any,
    user,
    "from user1",
    `https://something`
  );
  const postId2 = await postArticle(client as any, user2, "from user2", `https://somethingmore`);

  await articleVote(client as any, user, "article:" + postId2);
  await articleVote(client as any, user2, "article:" + postId, true);
  const posts = await getArticles(client as any, 1);
  console.log("Posts with top votes", posts);

  await client.disconnect();
}

main();
