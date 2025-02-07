export function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dog = searchParams.get('dog');
    return Response.json({
        message: `Hello!`
    });
}
