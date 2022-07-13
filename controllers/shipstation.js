const axios = require("axios");

const SKUs = ['cb1', 'cb3', 'cb6', 'essentials'];

/**
 * Receives and processes a new order webhook from ShipStation.
 */
exports.newOrders = async (req, res, next) => {
  try {
    // Retrieve the URL from the ShipStation webhook.
    const url = req.body.resource_url;

    // Pull the new orders
    const response = await shipstationApiCall(url);

    // If there are new orders, analyze the new orders.
    if (response.data.orders.length >= 1) {

      // skip splittig order that are already splitted 
      let filterOrders = response.data.orders.filter((order) => !order.orderNumber.toLowerCase().includes('-'));

      let splitOrders = [];
      // if only one type of sku in order then do not split

      filterOrders.forEach((order) => {
        let distinctSKUs = order.items.map((item) => {
          if (item.sku.toLowerCase().includes('cb1')) {
            return 'cb1';
          } else if (item.sku.toLowerCase().includes('cb3')) {
            return 'cb3';
          } else if (item.sku.toLowerCase().includes('cb6')) {
            return 'cb6';
          } else if (item.sku.toLowerCase().includes('essentials')) {
            return 'essentials';
          } else if (item.sku.toLowerCase().includes('routeins')) {
            return 'routeins';
          } else {
            return item.sku.toLowerCase();
          }
        });
        distinctSKUs = [...new Set(distinctSKUs)];
        console.log('distinctSKUs>>>>', distinctSKUs)
        if (distinctSKUs.length === 1 && SKUs.indexOf(distinctSKUs[0]) >= 0) {
          // do nothing
        } else if (distinctSKUs.length === 2) {
          if (distinctSKUs.indexOf('routeins') >= 0 && ((SKUs.indexOf(distinctSKUs[0]) >= 0) || (SKUs.indexOf(distinctSKUs[1]) >= 0)) ) {
            // do nothing
          } else {
            splitOrders.push(order);
          }
        } else {
          splitOrders.push(order);
        }
      });

      analyzeOrders(splitOrders);
    }

    // Reply to the REST API request that new orders have been analyzed.
    res.status(200).json({
      message: `Analyzed ${response.data.orders.length} new order(s).`,
      data: response.data.orders,
    });
  } catch (err) {
    throw new Error(err);
  }
};

/**
 * Analyzs a new order from ShipStation to determine if a split is necessary.
 *
 * @param  {array} newOrders an array of order objects from ShipStation
 */
const analyzeOrders = async (newOrders) => {
  // Loop through each new order.
  for (let x = 0; x < newOrders.length; x++) {
    try {
      const order = newOrders[x];

      // CB1 or CB3 or CB6 or ESSENTIALS
      const SKUs = ['cb1', 'cb3', 'cb6', 'essentials'];
      const itemSKUs = [];
      SKUs.forEach((SKU) => {
        if (order.items.find((item) => item.sku != null && item.sku.toLowerCase().includes(SKU))) {
          itemSKUs.push(SKU);
        }
      });

      if (itemSKUs.length > 0) {
        const orderUpdateArray = await splitShipstationOrder(order, itemSKUs);
        await shipstationApiCall(
          "https://ssapi.shipstation.com/orders/createorders",
          "post",
          orderUpdateArray
        );
      }
    } catch (err) {
      throw new Error(err);
    }
  }
};

/**
 * Copies the primary order for each new order, adjusting the items on each to correspond
 * to the correct SKU.
 *
 * @param  {object} order an order object from the ShipStation API
 * @param {array} SKUs an array of strings containing the SKU names
 *
 * @return {array} an array of order objects to be updated in ShipStation
 */
const splitShipstationOrder = async (order, SKUs) => {
  let orderUpdateArray = [];

  let mainOrder = { ...order };
  mainOrder.items = mainOrder.items.filter((item) => {
    return item.sku == null || (!item.sku.toLowerCase().includes("cb1") && !item.sku.toLowerCase().includes("cb3") && !item.sku.toLowerCase().includes("cb6") && !item.sku.toLowerCase().includes("essentials"));
  });
  if (mainOrder.items.length > 0) {
    orderUpdateArray.push(mainOrder);
  }
  let updatedMainOrder = false;
  // Loop through every SKU present on the order.
  for (let x = 0; x < SKUs.length; x++) {
    try {
      // Create a copy of the original order object.
      let tempOrder = { ...order };

      // Give the new order a number to include the SKU as a suffix.
      tempOrder.orderNumber = `${tempOrder.orderNumber}-${SKUs[x]}`;

      // Filter for the order items for this specific SKU.
      tempOrder.items = tempOrder.items.filter((item) => {
        return item.sku != null && item.sku.toLowerCase().includes(SKUs[x]);
      });

      console.log(`tempOrder.items for ${SKUs[x]}`, tempOrder.orderNumber, tempOrder.items);

      // If this is not the first (primary) order, set the object to create new order in ShipStation.
      if (mainOrder.items.length === 0 && !updatedMainOrder) {
        updatedMainOrder = true;
      } else {
        delete tempOrder.orderKey;
        delete tempOrder.orderId;
        tempOrder.amountPaid = 0;
        tempOrder.taxAmount = 0;
        tempOrder.shippingAmount = 0;
      }

      orderUpdateArray.push(tempOrder);
    } catch (err) {
      throw new Error(err);
    }
  }
  console.log('orderUpdateArray>>>>', orderUpdateArray);
  return orderUpdateArray;
};

/**
 * Performs a ShipStation API Call
 *
 * @param {string} url the full URL to call from ShipStation
 * @param {string} method generally "get" or "post"
 * @param {JSON} body the body of a POST request (if applicable)
 *
 * @return {JSON} the response from the API call
 */
const shipstationApiCall = async (url, method, body) => {
  try {
    const config = {
      method: method || "get",
      url: url,
      headers: {
        // Your API Authorization token goes here.
        Authorization: `Basic ${process.env.SHIPSTATION_API_KEY}`,
        "Content-Type": "application/json",
      },
    };

    if (body && method.toLowerCase() === "post") {
      config["data"] = JSON.stringify(body);
    }

    const response = await axios(config);
    return response;
  } catch (err) {
    throw new Error(err);
  }
};
