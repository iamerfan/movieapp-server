import compression from "compression";
import express from "express";
import morgan from "morgan";
import dotenv from "dotenv";
import helmet from "helmet";
import axios from "axios";
import cors from "cors";
import cheerio from "cheerio";
const app = express();

//HTTP Security and Compression's and Log's and Cors Errors
app.use(helmet());
app.use(compression());
app.use(morgan("dev"));
app.use(cors());

//env
dotenv.config();
const port = process.env.PORT || 4000;
const { SERVER, API_KEY, EXTRA_URL } = process.env;

//server start
app.listen(port, () => console.log(`Running on port ${port}`));

//apis
app.get("/api/home", async (req, res) => {
  const type = req.query.type || "movie";
  const handleUrl = (url) => `${SERVER}/${url}?page=1&${API_KEY}`;

  const urls = [
    `${type}/popular`,
    `trending/${type}/day`,
    `${type === "movie" ? "movie/upcoming" : "tv/airing_today"}`,
    `${type}/top_rated`,
  ].map(handleUrl);

  const handleAxios = async (url) => {
    try {
      const { data } = await axios.get(url);
      return data.results;
    } catch (error) {
      console.error(`Error occurred while fetching data from ${url}: ${error}`);
      throw error; // re-throw the error to be caught by the caller
    }
  };

  try {
    const response = await Promise.all(urls.map(handleAxios));
    return res.status(200).json(response);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "An error occurred while fetching data." });
  }
});
app.get("/api/episode/:id/:season/:episode", async (req, res) => {
  if (!SERVER || !API_KEY) {
    return res.status(500).json({ error: "Server or API key not set" });
  }

  const { episode, id, season } = req.params;
  const url = `${SERVER}/tv/${id}/season/${season}/episode/${episode}?${API_KEY}`;
  const seasonUrl = `${SERVER}/tv/${id}/season/${season}?${API_KEY}`;

  try {
    const [{ data: episodeData }, { data: seasonData }] = await Promise.all([
      axios.get(url),
      axios.get(seasonUrl),
    ]);

    return res.status(200).json({
      seasonData,
      ...episodeData,
      crew: episodeData.crew.slice(0, 20),
      guest_stars: episodeData.guest_stars.slice(0, 20),
    });
  } catch (error) {
    return res.status(500).json({ error: error.toString() });
  }
});
app.get("/api/genres/:type/:id/:page/:sort", async (req, res) => {
  const { id, page, sort, type } = req.params;
  const url = `${SERVER}/discover/${type}/?${API_KEY}&with_genres=${id}&page=${page}&sort_by=${sort}`;
  const allGenresUrl = `${SERVER}/genre/${type}/list?${API_KEY}`;

  try {
    const [data, allGenres] = await Promise.all([
      axios.get(url),
      axios.get(allGenresUrl),
    ]);

    return res.status(200).json({ ...data.data, ...allGenres.data });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "An error occurred while fetching data" });
  }
});
app.get("/api/person/:id", async (req, res) => {
  const { id } = req.params;
  const url = `${process.env.SERVER}/person/${id}?${process.env.API_KEY}`;
  const appearedInUrl = `${process.env.SERVER}/discover/movie?${process.env.API_KEY}&with_people=${id}`;
  try {
    const [personData, moviesData] = await Promise.all([
      axios.get(url),
      axios.get(appearedInUrl),
    ]);
    const data = personData.data;
    const movies = moviesData.data.results;
    return res.status(200).json({ ...data, movies });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "An error occurred while fetching data" });
  }
});
app.get("/api/search/:q/:page?", async (req, res) => {
  const { q, page } = req.params;
  const handleUrl = (key) => {
    return `${SERVER}/search/${key}?${API_KEY}&query=${q}&page=${page || 1}`;
  };
  const multi = handleUrl("multi");
  const urls = [multi];

  const handleAxios = async (url) => {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching data from ${url}: ${error}`);
      return null;
    }
  };
  const promises = urls.map((url) => handleAxios(url));

  Promise.all(promises)
    .then((values) => {
      const response = { multi: values[0] };
      res.status(200).json(response);
    })
    .catch((error) => {
      console.error(`Error in Promise.all: ${error}`);
      res.status(500).json({ error: "An error occurred" });
    });
});
app.get("/api/title/:type/:id/:seasonId?", async (req, res) => {
  const { type, id, seasonId } = req.params;

  const handleUrls = (url) => `${SERVER}/${type}/${id}${url}?${API_KEY}`;

  const urls = [
    handleUrls(""),
    handleUrls("/external_ids"),
    handleUrls("/credits"),
    handleUrls("/images"),
    handleUrls("/reviews"),
    handleUrls("/similar"),
    seasonId && handleUrls(`/season/${seasonId}`),
    handleUrls("/videos"),
  ].filter((url) => url !== undefined);

  const reduceTo20Items = (arry) => arry.slice(0, 20);

  const filterVideos = (arry) => {
    const filtered = arry.filter((video) => video.type === "Trailer");
    const filteredKeyValues = filtered.map((video) => video.key);
    return filteredKeyValues;
  };

  const handleAxios = async (url) => {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error(`Error fetching data from ${url}: ${error}`);
      return null;
    }
  };

  const promises = urls.map(handleAxios);

  try {
    const values = await Promise.all(promises);

    const response = {
      details: values[0],
      ids: values[1],
      credits: values[2],
      images: {
        backdrops: reduceTo20Items(values[3].backdrops),
        logos: reduceTo20Items(values[3].logos),
        posters: reduceTo20Items(values[3].posters),
      },
      reviews: values[4],
      similar: values[5],
      season: values[6] || [],
      videos: filterVideos(values[values.length - 1].results),
    };

    const { ids } = response;
    const imdbId = ids.imdb_id;

    if (imdbId) {
      const extra = await axios
        .get(`${EXTRA_URL}${imdbId}`)
        .then(({ data }) => data)
        .catch((e) => console.log(e));

      const { data } = await axios.get(
        `http://localhost:${port}/api/movie/${extra.Year}/${imdbId}`
      );
      if (data.status == 200) {
        return res.status(200).json({
          ...response,
          extra,
          downloadLinks: data.result,
        });
      }
      return res.status(200).json({
        ...response,
        extra,
        downloadLinks: [],
      });
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error(`Error in Promise.all: ${error}`);
    return res.status(500).json({ error: `An error occurred:${error}` });
  }
});

app.get("/api/cron", async (req, res) =>
  res.status(200).json("CronJob Happend !")
);

app.get("/api/movie/:imdbId", async (req, res) => {
  try {
    const { imdbId } = req.params;

    if (!imdbId) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const { data: extra } = await axios.get(`${EXTRA_URL}${imdbId}`);

    const id = imdbId.slice(2);
    const url = `https://berlin.saymyname.website/Movies/${extra.Year}/${id}/`;
    const { data: html } = await axios.get(url);

    if (!html) {
      return res.status(500).json({ error: "Failed to fetch HTML" });
    }

    const $ = cheerio.load(html);
    const links = $("tr");
    const result = [];

    links.each((i, el) => {
      const text = $(el).find(".n>a>code").text();
      const size = $(el).find(".s>code").text();
      const link = url + $(el).find(".n>a").attr("href");

      if (i > 1) {
        result.push({ text, size, link });
      }
    });

    return res.status(200).json({ status: 200, result });
  } catch (error) {
    return res
      .status(200)
      .json({ status: 404, error: "Not Found", result: [] });
  }
});
