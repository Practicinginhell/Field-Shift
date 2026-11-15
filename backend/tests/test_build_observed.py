from tools import build_observed

HEADER = "ID,Latitude,Longitude,Date,HLS_Tile,HLSL30_VI_020_NDVI\n"


def test_a_moved_field_takes_its_rows_only_from_the_request_at_its_new_point(tmp_path, monkeypatch):
    monkeypatch.setattr(
        build_observed,
        "FIELDS",
        [
            {"id": "iowa", "latitude": 42.38, "longitude": -93.75},
            {"id": "nevada", "latitude": 39.465, "longitude": -118.865},
        ],
    )
    # The first request had Nevada at its old point; a later one asked for the new point.
    (tmp_path / "v2-hls-HLSL30-VI-020-results.csv").write_text(
        HEADER
        + "iowa,42.38,-93.75,2019-07-01,15TVG,0.8\n"
        + "nevada,39.47,-118.85,2019-07-01,11SKJ,0.7\n"
    )
    (tmp_path / "v2-nevada-hls-HLSL30-VI-020-results.csv").write_text(
        HEADER + "nevada,39.465,-118.865,2019-07-02,11SKJ,0.5\n"
    )

    rows, overpasses = build_observed._layer(tmp_path, "HLSL30-VI-020", "HLSL30_VI_020_NDVI")

    assert {fid: [v for _, v in r] for fid, r in rows.items()} == {"iowa": [0.8], "nevada": [0.5]}
    assert overpasses == {"iowa": 1, "nevada": 1}
