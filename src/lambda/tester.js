const AWS = require('aws-sdk');
AWS.config.update({
    region: "ap-northeast-2"
});
const moment = require('moment');
const chromium = require('chrome-aws-lambda');

exports.handler = async(event, context) => {
    console.log(event);

    var docClient = new AWS.DynamoDB.DocumentClient();
    try {
        browser = await chromium.puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });
        let page = await browser.newPage();
        await page.goto(`https://gall.dcinside.com/board/lists/?id=jijinhee`);
        //로딩 대기
        await page.waitForSelector(`[class='gall_list']`)
            //인덱스 번호 조회
        const idxes = await page.evaluate(() => {
            let tds = Array.from(document.querySelectorAll(`[class='gall_num']`));
            console.log(tds);
            return tds.map(td => {
                return (!isNaN(parseInt(td.innerText))) ? parseInt(td.innerText) : 0
            })
        });
        //인덱스 중 가장 최신을 찾기
        let maxIndexFound = idxes.sort().reverse()[0];
        //우선 이전 최종 인덱스를 가져온다.
        var params = {
            TableName: 'data-record',
            KeyConditionExpression: '#HashKey = :hkey',
            ExpressionAttributeNames: { '#HashKey': 'board_name' },
            ExpressionAttributeValues: {
                ':hkey': "earthquake"
            }
        };
        const result = await docClient.query(params).promise();
        let itm = result.Items[0];
        let lastMaxIndex = (itm) ? itm.max_index : maxIndexFound;

        console.log("lastMaxIndex:", lastMaxIndex, "maxIndexFound:", maxIndexFound)
            //비교해서 변화가 있다면
        let delta = maxIndexFound - lastMaxIndex;
        if (delta > 0) {
            let sns = new AWS.SNS({ apiVersion: '2010-03-31', region: "us-east-1" });
            var params = {
                Message: `[지진 감지] 지진희 갤러리에 글이 5분간 ${delta}개 게시되었습니다.`,
                PhoneNumber: process.env.PhoneNumber,
            };
            try {
                let result = await sns.publish(params).promise();
                console.log(result);
            } catch (e) {
                console.log(e);
            }
        }
        const now = moment();
        var params = {
            TableName: 'data-record',
            Key: { board_name: 'earthquake' },
            UpdateExpression: 'set #a = :x, #b = :y',
            ExpressionAttributeNames: { '#a': 'max_index', '#b': 'last_updated' },
            ExpressionAttributeValues: {
                ':x': maxIndexFound,
                ':y': now.format("YYYY-MM-DD HH:mm:ss"),
            }
        };
        await docClient.update(params).promise();
    } catch (error) {
        console.log(error);
    } finally {
        if (browser !== null) {
            let pages = await browser.pages()
            await Promise.all(pages.map(page => page.close()))
            await browser.close();
        }
    }
    return "ok"
}