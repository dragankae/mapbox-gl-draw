const turf = require('@turf/turf');
const cheapRuler = require('cheap-ruler');
const xtend = require('xtend');
const StringSet = require('../lib/string_set');

function toPointArray(feature) {
  const result = [];
  turf.coordAll(feature).forEach((coords) => {
    result.push(turf.point(coords));
  });
  return result;
}

function toLineStrings(feature) {
  const result = [];
  const flat = turf.flatten(feature);
  turf.geomEach(flat, (geometry) => {
    result.push(turf.lineString(geometry.coordinates));
  });

  return result;
}

function findConnectingLine(startPoint, endPoint, geojson) {
  let result = null;
  let features = 0;
  let coords = 0;

  turf.featureEach(geojson, (feature) => {
    if (!result) {

      features++;
      let startIndex = -1;
      let endIndex = -1;
      turf.coordEach(feature, (coord, index) => {
        coords++;
        if (startIndex === -1 && (coord[0] === startPoint[0] && coord[1] === startPoint[1])) {
          startIndex = index;
        }
        if (endIndex === -1 && (coord[0] === endPoint[0] && coord[1] === endPoint[1])) {
          endIndex = index;
        }
        if (startIndex !== -1 && endIndex !== -1 && startIndex !== endIndex) {
          const resultCoords = [];
          if (startIndex > endIndex) {
            const saveIndex = endIndex;
            endIndex = startIndex;
            startIndex = saveIndex;
          }
          for (let x = startIndex; x < endIndex; x++) {
            resultCoords.push(feature.geometry.coordinates[x]);
          }
          if (resultCoords.length > 1) {
            result = turf.lineString(resultCoords);
          }
        }
      });
    }
  });

  return result;
}


// All are required
function snapTo(evt, ctx, id) {
  if (ctx.map === null) return [];

  const line = ctx.store.get(id);
  let lastLinePoint = null;

  const buffer = ctx.options.snapBuffer;
  const box = [
    [evt.point.x - buffer, evt.point.y - buffer],
    [evt.point.x + buffer, evt.point.y + buffer]
  ];

  let distanceBox = null;
  if (line && line.coordinates.length > 1) {
    // todo check rouler.bufferBBox
    lastLinePoint = line.coordinates[line.coordinates.length - 2];
    const lastPoint = ctx.map.project(lastLinePoint);

    const extendBox = [
      [lastPoint.x - buffer, lastPoint.y - buffer],
      [lastPoint.x + buffer, lastPoint.y + buffer],
      [evt.point.x - buffer, evt.point.y - buffer],
      [evt.point.x + buffer, evt.point.y + buffer]
    ];

    const bboxPoints = [];
    extendBox.forEach((element) => {
      const point = ctx.map.unproject(element);
      bboxPoints.push(turf.point([point.lng, point.lat]));
    });

    const bbox = turf.bbox(turf.featureCollection(bboxPoints));

    distanceBox = [[bbox[0], bbox[1]], [bbox[2], bbox[1]],
    [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]];
    /*    distanceBox = [
     [evt.lngLat.lng, evt.lngLat.lat], [lastLinePoint[0], evt.lngLat.lat],
     [lastLinePoint[0], lastLinePoint[1]], [evt.lngLat.lng, lastLinePoint[1]],
     [evt.lngLat.lng, evt.lngLat.lat]
     ];*/

    const pos1 = ctx.map.project(distanceBox[0]);
    const pos2 = ctx.map.project(distanceBox[2]);
    box[0] = [pos1.x, pos1.y];
    box[1] = [pos2.x, pos2.y];
  }

  const snapFilter = { layers: ctx.store._snapLayers.values() };

  const featureIds = new StringSet();
  const uniqueFeatures = [];
  const evtCoords = (evt.lngLat.toArray !== undefined) ? evt.lngLat.toArray() : undefined;

  let closestDistance = null;
  let closestCoord;
  let closestFeature;

  const eventPoint = {
    "type": "Feature",
    "properties": {},
    "geometry": {
      "type": "Point",
      "coordinates": [0, 0]
    }
  };

  const selectedElements = {
    "type": "FeatureCollection",
    "features": []
  };
  if (distanceBox) {
    selectedElements.features.push(turf.lineString(distanceBox));
  }

  if (ctx.map.getSource("snap-source") === undefined) {
    ctx.map.addSource('snap-source', {
      type: 'geojson',
      data: eventPoint
    });
  }
  if (ctx.map.getLayer("snap-layer") === undefined) {
    ctx.map.addLayer(xtend({
      id: "snap-layer",
      source: "snap-source"
    }, ctx.options.snapStyle)
    );
  }

  const renderedFeatures = ctx.map.queryRenderedFeatures(box, snapFilter);
  renderedFeatures.forEach((feature) => {
    const featureId = feature.properties.id;

    if (featureId !== undefined) {
      if (featureIds.has(featureId) || String(featureId) === id) {
        return;
      }
      featureIds.add(featureId);
    }
    /*    const points = toPointArray(feature);
     points.forEach((point) => {
     selectedElements.features.push(point);
     });*/
    const lines = toLineStrings(feature);
    selectedElements.features.push(...lines);
    return uniqueFeatures.push(feature);
  });

  if (evtCoords === undefined || uniqueFeatures.length < 1) {
    //remove point
    ctx.map.getSource("snap-source").setData({
      "type": "FeatureCollection",
      "features": []
    });

    return evt;
  }

  const closestPoints = function (ruler, coordinates, evtCoords) {
    const result = [];
    const pointIndex = ruler.pointOnLine(coordinates, evtCoords);
    result.push({ type: "linepoint", coords: pointIndex.point });
    let vertex = null;
    if (pointIndex.index === coordinates.length) {
      vertex = coordinates[pointIndex.index];
    } else {
      const p1 = coordinates[pointIndex.index];
      const p2 = coordinates[pointIndex.index + 1];
      const distance1 = ruler.distance(p1, evtCoords);
      const distance2 = ruler.distance(p2, evtCoords);
      vertex = distance1 < distance2 ? p1 : p2;
    }
    result.push({ type: "vertex", coords: vertex });
    return result;
  };

  //snapto line
  uniqueFeatures.forEach((feature) => {
    const type = feature.geometry.type;
    const coords = [];
    const ruler = cheapRuler.fromTile(feature._vectorTileFeature._y, feature._vectorTileFeature._z); //z is max map zoom of 20

    if (type === "LineString") {
      closestPoints(ruler, feature.geometry.coordinates, evtCoords).forEach((pointType) => {
        coords.push(pointType);
      });
    } else if (type === "Point") {
      coords.push({ type: "vertex", coords: feature.geometry.coordinates });
    } else if (type === "MultiLineString" || type === "Polygon") {
      feature.geometry.coordinates.forEach((coordinates) => {
        closestPoints(ruler, coordinates, evtCoords).forEach((pointType) => {
          coords.push(pointType);
        });
      });
    }

    if (coords.length === 0) {
      console.log("coords empty for feature: ", feature);
    } else {
      coords.forEach((pointType) => {
        const singleCoords = pointType.coords;
        const dist = ruler.distance(singleCoords, evtCoords);
        if (dist !== null) {
          if ((closestDistance === null || ((pointType.type === "vertex" && dist < 0.004) ||
            (dist < closestDistance))) && dist < 0.008) {
            feature.distance = dist;
            closestFeature = feature;
            closestCoord = singleCoords;
            closestDistance = dist;
          }
        }
      });
    }
  });

  if (closestDistance !== null) {
    evt.lngLat.lng = closestCoord[0];
    evt.lngLat.lat = closestCoord[1];

    let pointsBetween = null;
    if (lastLinePoint) {
      pointsBetween = findConnectingLine(closestCoord, lastLinePoint, selectedElements);
    }
    evt.point = ctx.map.project(closestCoord);
    evt.snap = true;
    eventPoint.geometry.coordinates = closestCoord;
    const features = [eventPoint];
    if (pointsBetween) {
      features.push(pointsBetween);
    }
    ctx.map.getSource("snap-source").setData(turf.featureCollection(features));
  } else {
    ctx.map.getSource("snap-source").setData(turf.featureCollection([]));
  }
  return evt;
};

// All are required
function cleanSnapTo(ctx) {
  if (ctx.map === null || ctx.map.getSource("snap-source") === undefined) return;
  ctx.map.getSource("snap-source").setData(turf.featureCollection([]));
}


module.exports = {
  snapTo,
  cleanSnapTo
}
