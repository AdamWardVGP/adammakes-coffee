import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
    const software = await getCollection("software");
    const recipes = await getCollection("recipes");
    const cats = await getCollection("cats");

    const items = [
        ...software.map((post) => ({
            title: post.data.title,
            description: post.data.description ?? "",
            pubDate: post.data.date,
            link: `/software/${post.slug}/`,
            categories: ["software"],
        })),
        ...recipes.map((post) => ({
            title: post.data.title,
            description: post.data.description ?? "",
            pubDate: post.data.date,
            link: `/recipes/${post.slug}/`,
            categories: ["recipes"],
        })),
        ...cats.map((post) => ({
            title: post.data.title,
            description: post.data.description ?? "",
            pubDate: post.data.date,
            link: `/catOps/${post.slug}/`,
            categories: ["catOps"],
        })),
    ].sort((a, b) => b.pubDate - a.pubDate);

    return rss({
        title: "Adam Makes Coffee",
        description: "Recipes, projects, and updates from Adam Makes Coffee.",
        site: context.site,
        items,
    });
}
